import test from 'node:test';
import assert from 'node:assert/strict';
import authHandler from '../api/auth.js';
import callbackHandler from '../api/callback.js';

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    end(body = '') { this.body = body; return this; },
    redirect(code, location) {
      this.statusCode = code;
      this.headers.Location = location;
      return this;
    },
  };
}

test('OAuth start redirects to GitHub with a state cookie and the canonical callback', () => {
  const previous = { id: process.env.GITHUB_OAUTH_CLIENT_ID, secret: process.env.GITHUB_OAUTH_CLIENT_SECRET };
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret';
  try {
    const res = mockResponse();
    authHandler({ method: 'GET', query: { provider: 'github' } }, res);
    const redirect = new URL(res.headers.Location);
    assert.equal(res.statusCode, 302);
    assert.equal(redirect.origin, 'https://github.com');
    assert.equal(redirect.pathname, '/login/oauth/authorize');
    assert.equal(redirect.searchParams.get('client_id'), 'test-client-id');
    assert.equal(redirect.searchParams.get('redirect_uri'), 'https://ams-builds.online/callback');
    assert.match(res.headers['Set-Cookie'], /ams_decap_oauth_state=.*HttpOnly; Secure; SameSite=Lax/);
    assert.ok(redirect.searchParams.get('state'));
  } finally {
    if (previous.id === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
    else process.env.GITHUB_OAUTH_CLIENT_ID = previous.id;
    if (previous.secret === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.GITHUB_OAUTH_CLIENT_SECRET = previous.secret;
  }
});

test('OAuth callback rejects a mismatched state without calling GitHub', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not call GitHub'); };
  try {
    const res = mockResponse();
    await callbackHandler({
      method: 'GET',
      query: { code: 'one-time-code', state: 'wrong-state' },
      headers: { cookie: 'ams_decap_oauth_state=expected-state' },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /OAuth state check failed/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth callback exchanges a valid code and returns a Decap success message', async () => {
  const previous = { id: process.env.GITHUB_OAUTH_CLIENT_ID, secret: process.env.GITHUB_OAUTH_CLIENT_SECRET };
  const originalFetch = globalThis.fetch;
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ access_token: 'github-access-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const res = mockResponse();
    await callbackHandler({
      method: 'GET',
      query: { code: 'one-time-code', state: 'expected-state' },
      headers: { cookie: 'ams_decap_oauth_state=expected-state' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(request.url, 'https://github.com/login/oauth/access_token');
    assert.match(request.options.body, /"client_secret":"test-client-secret"/);
    assert.match(res.body, /authorization:github:success:/);
    assert.match(res.body, /github-access-token/);
    assert.match(res.body, /window\.opener\.postMessage/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.id === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
    else process.env.GITHUB_OAUTH_CLIENT_ID = previous.id;
    if (previous.secret === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.GITHUB_OAUTH_CLIENT_SECRET = previous.secret;
  }
});
