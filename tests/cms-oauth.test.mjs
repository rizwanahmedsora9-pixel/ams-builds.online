import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as yaml from 'js-yaml';

import authHandler from '../api/auth.js';
import callbackHandler from '../api/callback.js';
import worker from '../worker/index.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

function createMockRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end(payload = '') {
      this.body = payload;
      return this;
    },
  };
}

/**
 * Simulates Decap CMS's NetlifyAuthenticator opener window in node:vm and runs
 * the <script> emitted by /callback to verify the two-step postMessage flow.
 */
function runPopupHandshake(html, { openerOrigin, replyOrigin = openerOrigin }) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'callback HTML must contain inline <script>');

  const sentToOpener = [];
  const popupListeners = [];
  let closed = false;

  const popupWindow = {
    closed: false,
    close() {
      closed = true;
      this.closed = true;
    },
    addEventListener(type, fn) {
      if (type === 'message') popupListeners.push(fn);
    },
    removeEventListener(type, fn) {
      const idx = popupListeners.indexOf(fn);
      if (idx >= 0) popupListeners.splice(idx, 1);
    },
    opener: {
      postMessage(data, targetOrigin) {
        sentToOpener.push({ data, targetOrigin });
        if (data === 'authorizing:github' && replyOrigin) {
          for (const fn of [...popupListeners]) {
            fn({ data: 'authorizing:github', origin: replyOrigin });
          }
        }
      },
    },
  };

  vm.runInNewContext(match[1], {
    window: popupWindow,
    document: { getElementById: () => ({ textContent: '' }) },
    setTimeout: (fn) => {
      fn();
      return 1;
    },
  });

  return { sentToOpener, closed };
}

test('Decap CMS config.yml is structurally valid and aligned with repository content', () => {
  const raw = fs.readFileSync(path.join(repoRoot, 'public/admin/config.yml'), 'utf8');
  const cfg = yaml.load(raw);

  assert.equal(cfg.backend?.name, 'github');
  assert.equal(cfg.backend?.repo, 'rizwanahmedsora9-pixel/ams-builds.online');
  assert.equal(cfg.backend?.branch, 'main');
  assert.equal(cfg.backend?.auth_endpoint, 'auth');
  assert.ok(cfg.media_folder, 'media_folder is required');
  assert.ok(cfg.public_folder, 'public_folder is required');
  assert.ok(Array.isArray(cfg.collections) && cfg.collections.length >= 4);

  for (const col of cfg.collections) {
    assert.ok(col.name && col.label, `collection missing name/label: ${JSON.stringify(col)}`);
    const hasFiles = Array.isArray(col.files);
    const hasFolder = typeof col.folder === 'string';
    assert.notEqual(
      hasFiles,
      hasFolder,
      `collection "${col.name}" must define either files or folder (not both/neither)`
    );
    assert.equal(
      Boolean(col.fields && hasFiles),
      false,
      `file collection "${col.name}" must nest fields inside each files[] entry, not at collection level`
    );

    if (hasFiles) {
      for (const fileEntry of col.files) {
        assert.ok(fileEntry.name && fileEntry.label && fileEntry.file, `invalid file entry in ${col.name}`);
        assert.ok(
          Array.isArray(fileEntry.fields) && fileEntry.fields.length > 0,
          `files entry "${fileEntry.name}" in "${col.name}" must have non-empty fields[]`
        );
        assert.ok(
          fs.existsSync(path.join(repoRoot, fileEntry.file)),
          `referenced CMS file does not exist: ${fileEntry.file}`
        );
      }
    }

    if (hasFolder) {
      assert.ok(Array.isArray(col.fields) && col.fields.length > 0, `folder collection "${col.name}" needs fields[]`);
      assert.ok(
        fs.existsSync(path.join(repoRoot, col.folder)),
        `referenced CMS folder does not exist: ${col.folder}`
      );
      for (const field of col.fields) {
        if (field.widget === 'datetime') {
          assert.equal(field.format, 'YYYY-MM-DD', `${col.name}.${field.name} must format dates as YYYY-MM-DD`);
          assert.equal(field.time_format, false, `${col.name}.${field.name} must disable time_format`);
        }
      }
    }
  }
});

test('Admin HTML manually initializes Decap CMS against window.location.origin and wrangler.jsonc wires Worker routes', () => {
  const adminHtml = fs.readFileSync(path.join(repoRoot, 'public/admin/index.html'), 'utf8');
  const manualInitPos = adminHtml.indexOf('window.CMS_MANUAL_INIT = true');
  const bundlePos = adminHtml.indexOf('decap-cms@^3.0.0/dist/decap-cms.js');
  const initCallPos = adminHtml.indexOf('window.CMS.init(');

  assert.ok(manualInitPos !== -1, 'CMS_MANUAL_INIT flag must be present');
  assert.ok(bundlePos > manualInitPos, 'CMS_MANUAL_INIT must execute before decap-cms.js loads');
  assert.ok(initCallPos > bundlePos, 'CMS.init must execute after decap-cms.js loads');
  assert.match(adminHtml, /var origin = window\.location\.origin/);
  assert.match(adminHtml, /base_url:\s*origin/);
  assert.match(adminHtml, /site_url:\s*origin/);

  const wranglerRaw = fs.readFileSync(path.join(repoRoot, 'wrangler.jsonc'), 'utf8');
  const wranglerJson = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(wranglerJson.main, './worker/index.js');
  assert.equal(wranglerJson.assets?.directory, './dist');
  assert.equal(wranglerJson.assets?.binding, 'ASSETS');
  assert.deepEqual(wranglerJson.previews, {});
  for (const route of ['/admin', '/auth', '/callback', '/api/auth', '/api/callback']) {
    assert.ok(
      wranglerJson.assets?.run_worker_first?.includes(route),
      `wrangler.jsonc run_worker_first must include ${route}`
    );
  }
});

test('Cloudflare Worker handles /admin redirect, missing OAuth secrets 503, OAuth flow, and static ASSETS fallback', async () => {
  let assetCalls = 0;
  const baseEnv = {
    ASSETS: {
      async fetch(req) {
        assetCalls += 1;
        return new Response(`asset:${new URL(req.url).pathname}`, { status: 200 });
      },
    },
  };

  // 1. /admin redirects to /admin/
  const adminRes = await worker.fetch(new Request('https://ams-builds-online.rizwanahmedsora9.workers.dev/admin'), baseEnv);
  assert.equal(adminRes.status, 301);
  assert.equal(adminRes.headers.get('location'), 'https://ams-builds-online.rizwanahmedsora9.workers.dev/admin/');

  // 2. /auth without secrets returns clear 503 setup instructions instead of 404
  const unconfiguredRes = await worker.fetch(
    new Request('https://ams-builds-online.rizwanahmedsora9.workers.dev/auth?provider=github&scope=repo'),
    baseEnv
  );
  assert.equal(unconfiguredRes.status, 503);
  const unconfiguredHtml = await unconfiguredRes.text();
  assert.match(unconfiguredHtml, /GITHUB_OAUTH_CLIENT_ID/);
  assert.match(unconfiguredHtml, /https:\/\/ams-builds-online\.rizwanahmedsora9\.workers\.dev\/callback/);

  // 3. Full Worker /auth -> /callback + two-step Decap postMessage handshake on workers.dev origin
  const workerOrigin = 'https://ams-builds-online.rizwanahmedsora9.workers.dev';
  const configuredEnv = {
    ...baseEnv,
    GITHUB_OAUTH_CLIENT_ID: 'cf_client_id',
    GITHUB_OAUTH_CLIENT_SECRET: 'cf_client_secret',
  };

  const authRes = await worker.fetch(
    new Request(`${workerOrigin}/auth?provider=github&site_id=ams-builds-online.rizwanahmedsora9.workers.dev&scope=repo`),
    configuredEnv
  );
  assert.equal(authRes.status, 302);
  const ghRedirect = new URL(authRes.headers.get('location'));
  assert.equal(ghRedirect.origin + ghRedirect.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(ghRedirect.searchParams.get('client_id'), 'cf_client_id');
  assert.equal(ghRedirect.searchParams.get('redirect_uri'), `${workerOrigin}/callback`);
  assert.equal(ghRedirect.searchParams.get('scope'), 'repo');
  const setCookie = authRes.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /Secure/);
  const state = ghRedirect.searchParams.get('state');

  // Localhost HTTP omits Secure attribute on state cookie
  const localAuthRes = await worker.fetch(new Request('http://localhost:8787/auth'), configuredEnv);
  assert.doesNotMatch(localAuthRes.headers.get('set-cookie') ?? '', /Secure/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ access_token: 'gho_worker_token_abc' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const cbRes = await worker.fetch(
      new Request(`${workerOrigin}/callback?code=code_ok&state=${encodeURIComponent(state)}`, {
        headers: { cookie: setCookie.split(';')[0] },
      }),
      configuredEnv
    );
    assert.equal(cbRes.status, 200);
    const cbHtml = await cbRes.text();

    // Untrusted origin reply is ignored
    const untrusted = runPopupHandshake(cbHtml, {
      openerOrigin: workerOrigin,
      replyOrigin: 'https://evil.example',
    });
    assert.equal(untrusted.sentToOpener.length, 1);
    assert.equal(untrusted.sentToOpener[0].data, 'authorizing:github');
    assert.equal(untrusted.closed, false);

    // Legitimate opener completes two-step handshake and receives token
    const trusted = runPopupHandshake(cbHtml, { openerOrigin: workerOrigin });
    assert.equal(trusted.sentToOpener.length, 2);
    assert.deepEqual(trusted.sentToOpener[0], {
      data: 'authorizing:github',
      targetOrigin: workerOrigin,
    });
    assert.deepEqual(trusted.sentToOpener[1], {
      data: 'authorization:github:success:{"token":"gho_worker_token_abc","provider":"github"}',
      targetOrigin: workerOrigin,
    });
    assert.equal(trusted.closed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 4. Static routes delegate to env.ASSETS
  const assetRes = await worker.fetch(new Request(`${workerOrigin}/admin/config.yml`), configuredEnv);
  assert.equal(await assetRes.text(), 'asset:/admin/config.yml');
  assert.equal(assetCalls, 1);
});

test('Vercel api/auth.js and api/callback.js complete OAuth and surface readable NetlifyError payloads', async () => {
  const prevId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const prevSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const prevUrl = process.env.CMS_PUBLIC_URL;
  process.env.GITHUB_OAUTH_CLIENT_ID = 'vercel_cid';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'vercel_csecret';
  process.env.CMS_PUBLIC_URL = 'https://ams-builds.online';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ access_token: 'gho_vercel_token_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const authRes = createMockRes();
    await authHandler(
      { method: 'GET', url: '/api/auth?provider=github&scope=repo', headers: { host: 'ams-builds.online' } },
      authRes
    );
    assert.equal(authRes.statusCode, 302);
    const loc = new URL(authRes.headers.get('location'));
    const state = loc.searchParams.get('state');
    const cookieHeader = authRes.headers.get('set-cookie').split(';')[0];

    const okRes = createMockRes();
    await callbackHandler(
      {
        method: 'GET',
        url: `/api/callback?code=abc&state=${encodeURIComponent(state)}`,
        headers: { host: 'ams-builds.online', cookie: cookieHeader },
      },
      okRes
    );
    assert.equal(okRes.statusCode, 200);
    const okHandshake = runPopupHandshake(okRes.body, { openerOrigin: 'https://ams-builds.online' });
    assert.equal(
      okHandshake.sentToOpener[1].data,
      'authorization:github:success:{"token":"gho_vercel_token_123","provider":"github"}'
    );

    // State mismatch emits { message, error } so Decap's NetlifyError.toString() shows message
    const badRes = createMockRes();
    await callbackHandler(
      {
        method: 'GET',
        url: '/api/callback?code=abc&state=wrong',
        headers: { host: 'ams-builds.online', cookie: 'ams_decap_oauth_state=expected' },
      },
      badRes
    );
    assert.equal(badRes.statusCode, 400);
    const badHandshake = runPopupHandshake(badRes.body, { openerOrigin: 'https://ams-builds.online' });
    assert.match(badHandshake.sentToOpener[1].data, /^authorization:github:error:/);
    const payload = JSON.parse(badHandshake.sentToOpener[1].data.slice('authorization:github:error:'.length));
    assert.match(payload.message, /OAuth state check failed/);
    assert.equal(payload.error, payload.message);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevId === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
    else process.env.GITHUB_OAUTH_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.GITHUB_OAUTH_CLIENT_SECRET = prevSecret;
    if (prevUrl === undefined) delete process.env.CMS_PUBLIC_URL;
    else process.env.CMS_PUBLIC_URL = prevUrl;
  }
});
