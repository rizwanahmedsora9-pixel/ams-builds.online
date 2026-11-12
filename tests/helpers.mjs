/**
 * Test harness shared by the suite and by single-focus test files.
 *
 * Boots the real server on a temporary data directory, keeps a cookie jar, and
 * exposes the few calls a test actually needs: get / anon / form / csrf /
 * adminPost / install. Keeping this here means a new test is five lines of
 * intent instead of forty lines of setup.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET = process.env.TARGET === 'cloudflare' ? 'cloudflare' : 'node';

export const ADMIN = { username: 'owner', email: 'owner@example.com', password: 'correct horse battery' };

export function createHarness() {
  let dataDir, child, port;
  const jar = new Map();
  let base = '';
  let admin = '/admin-panel';

  const freePort = () => new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });

  /** Boots the server. Call again with the same data directory to test a restart. */
  async function start() {
    dataDir = dataDir || mkdtempSync(join(tmpdir(), 'edge-cms-e2e-'));
    if (port) {
      // A restart: wait until the previous process has really let the port go.
      for (let i = 0; i < 100; i++) {
        const inUse = await new Promise((resolve) => {
          const probe = createServer();
          probe.once('error', () => resolve(true));
          probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(false)));
        });
        if (!inUse) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    } else {
      port = await freePort();
    }
    base = `http://127.0.0.1:${port}`;
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, TRUST_PROXY: '0' };
    const args = TARGET === 'node'
      ? ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs')]
      : [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--ip', '127.0.0.1', '--port', String(port),
        '--inspector-port', String(await freePort()), '--persist-to', dataDir, '--show-interactive-dev-session=false'];
    let output = '';
    child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
      try {
        const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return res.json();
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`server did not start within 60s:\n${output}`);
  }

  function stop() {
    return new Promise((resolve) => {
      const done = () => {
        // Wait for the socket to be released so a restart can reuse the port.
        const wait = () => fetch(`${base}/api/health`, { signal: AbortSignal.timeout(300) }).then(() => setTimeout(wait, 50)).catch(() => resolve());
        wait();
      };
      if (!child || child.exitCode !== null) return done();
      child.once('exit', done);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4000).unref();
    });
  }

  async function request(path, { method = 'GET', body, cookies = true, headers = {} } = {}) {
    const h = { ...headers };
    if (cookies && jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, { method, body, headers: h, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (cookies) {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (value === '' || /max-age=0/i.test(line)) jar.delete(name); else jar.set(name, value);
      }
    }
    // Both forms, because a zip download is bytes and every other response is
    // text; decoding once here keeps the call sites simple.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const loc = res.headers.get('location');
    return { status: res.status, text, bytes, headers: res.headers, location: loc ? decodeURIComponent(loc.replace(base, '')) : null };
  }

  const get = (path, opts) => request(path, opts);
  const anon = (path, opts) => request(path, { ...opts, cookies: false });
  const form = (fields) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) p.append(k, String(item));
    return p;
  };
  async function csrf() {
    const page = await get(`${admin}/login`);
    const html = page.status === 200 ? page.text : (await get(`${admin}/profile`)).text;
    const m = html.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(m, 'CSRF token is present in the form');
    return m[1];
  }
  const adminPost = async (path, fields) => request(admin + path, { method: 'POST', body: form({ _csrf: await csrf(), ...fields }) });
  const anonPost = (path, fields) => request(path, { method: 'POST', body: form(fields), cookies: false });

  /** Install the site and sign in, so a test starts from a working panel. */
  async function install(overrides = {}) {
    const fields = {
      username: ADMIN.username, email: ADMIN.email, password: ADMIN.password, password2: ADMIN.password,
      title: 'E2E Test Site', domain: 'example.com', slug: 'admin-panel', ...overrides,
    };
    const res = await request('/install', { method: 'POST', cookies: false, body: form(fields) });
    assert.equal(res.status, 200, 'installer completes');
    admin = '/' + (fields.slug || 'admin-panel');
    const login = await adminPost('/login', { login: ADMIN.username, password: ADMIN.password });
    assert.equal(login.status, 303, 'sign-in succeeds');
    return { admin, base };
  }

  return {
    start, stop, request, get, anon, form, csrf, adminPost, anonPost, install,
    /** The admin URL can move at runtime (Settings -> Admin slug). */
    setAdmin: (slug) => { admin = slug; },
    get admin() { return admin; },
    get base() { return base; },
    get dataDir() { return dataDir; },
    get jar() { return jar; },
    cleanup: () => rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }),
  };
}
