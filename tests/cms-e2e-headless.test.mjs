import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(import.meta.dirname, '..');
const configYaml = fs.readFileSync(path.join(repoRoot, 'public/admin/config.yml'), 'utf8');
const decapScriptPath = path.join(repoRoot, 'node_modules/decap-cms/dist/decap-cms.js');

test('Decap CMS boots in browser environment, completes OAuth popup handshake, and loads dashboard', async () => {
  const decapBundle = fs.readFileSync(decapScriptPath, 'utf8');

  const dom = new JSDOM(
    `<!doctype html>
<html>
<head>
  <link rel="cms-config-url" type="text/yaml" href="/admin/config.yml" />
  <script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js" id="decap-script"></script>
</head>
<body>
  <div id="nc-root"></div>
</body>
</html>`,
    {
      url: 'https://ams-builds.online/admin/',
      runScripts: 'dangerously',
    }
  );

  const { window } = dom;
  Object.defineProperty(window.document, 'currentScript', {
    value: window.document.getElementById('decap-script'),
    configurable: true,
  });
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {} }));

  // Canvas mock for Decap's progress indicator
  const gradient = { addColorStop: () => {} };
  const dummyCtx = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      getImageData: () => ({ data: [] }),
      measureText: () => ({ width: 10 }),
    },
    {
      get: (target, prop) => target[prop] || (() => {}),
      set: () => true,
    }
  );
  window.HTMLCanvasElement.prototype.getContext = () => dummyCtx;

  let popupWindow = null;
  let openedAuthUrl = null;

  class MockPopup {
    constructor(url) {
      this.url = url;
      this.listeners = [];
      this.closed = false;
    }
    focus() {}
    close() {
      this.closed = true;
    }
    postMessage(data, origin) {
      for (const cb of this.listeners) {
        cb({ data, origin });
      }
    }
    addEventListener(event, cb) {
      if (event === 'message') this.listeners.push(cb);
    }
    removeEventListener(event, cb) {
      this.listeners = this.listeners.filter((l) => l !== cb);
    }
  }

  window.open = (url) => {
    openedAuthUrl = url;
    popupWindow = new MockPopup(url);
    return popupWindow;
  };

  // Mock fetch: serves /admin/config.yml and GitHub API
  window.fetch = async (url, options = {}) => {
    if (url.includes('config.yml')) {
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/yaml; charset=utf-8' : null) },
        text: async () => configYaml,
      };
    }
    let data = {};
    if (url === 'https://api.github.com/user') {
      data = { login: 'cms-admin', name: 'CMS Administrator', avatar_url: 'https://github.com/admin.png' };
    } else if (url === 'https://api.github.com/repos/rizwanahmedsora9-pixel/ams-builds.online') {
      data = {
        name: 'ams-builds.online',
        owner: { login: 'rizwanahmedsora9-pixel' },
        permissions: { push: true, admin: true, pull: true },
        default_branch: 'main',
      };
    } else if (url.includes('/branches/main')) {
      data = { name: 'main', commit: { sha: 'f41beed4ac356c357fa03c3bb62f3ff875c4b7d2' } };
    } else if (url.includes('/git/trees') || url.includes('/contents')) {
      data = { tree: [] };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(data),
      json: async () => data,
    };
  };

  window.CMS_MANUAL_INIT = true;
  window.eval(decapBundle);

  window.CMS.init({
    config: {
      site_url: window.location.origin,
      display_url: window.location.origin,
      backend: { base_url: window.location.origin },
    },
  });

  // Step 1: Wait for login screen to render
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const buttons = Array.from(window.document.querySelectorAll('button'));
  const loginBtn = buttons.find((b) => b.textContent.includes('Login with GitHub'));
  assert.ok(loginBtn, 'Decap CMS must render "Login with GitHub" button');

  // Step 2: Click login
  loginBtn.click();
  assert.ok(openedAuthUrl, 'Clicking login must call window.open');
  assert.ok(openedAuthUrl.startsWith('https://ams-builds.online/auth'), 'Must open /auth endpoint');

  // Step 3: Run two-step popup handshake
  await new Promise((resolve) => setTimeout(resolve, 100));
  const handshake = 'authorizing:github';
  const expectedOrigin = 'https://ams-builds.online';
  const tokenPayload = { token: 'gho_verified_test_token', provider: 'github' };
  const resultMessage = `authorization:github:success:${JSON.stringify(tokenPayload)}`;

  let handshakeEchoed = false;
  popupWindow.addEventListener('message', (event) => {
    if (event.origin === expectedOrigin && event.data === handshake) {
      handshakeEchoed = true;
      window.dispatchEvent(
        new window.MessageEvent('message', {
          data: resultMessage,
          origin: expectedOrigin,
          source: popupWindow,
        })
      );
    }
  });

  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: handshake,
      origin: expectedOrigin,
      source: popupWindow,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(handshakeEchoed, 'Decap CMS must echo "authorizing:github" back to popup');

  // Step 4: Verify CMS enters dashboard and shows collections
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const bodyText = window.document.body.textContent;
  assert.ok(
    bodyText.includes('Collections') ||
      bodyText.includes('Pages') ||
      bodyText.includes('Projects') ||
      bodyText.includes('Site Settings'),
    `Decap CMS must render dashboard with collections, got: ${bodyText.slice(0, 300)}`
  );

  dom.window.close();
});
