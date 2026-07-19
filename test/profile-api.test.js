import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { configuredAdminEmails } from '../api/auth/profile.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  JW_ADMIN_EMAILS: process.env.JW_ADMIN_EMAILS
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) {
      this.statusCode = code;
      return { json: (body) => { this.body = body; } };
    }
  };
}

async function invoke({
  body,
  email = 'user@example.com',
  authId = '11111111-1111-4111-8111-111111111111',
  existing = null,
  adminEmails = ''
}) {
  process.env.SUPABASE_URL = 'https://project.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.JW_ADMIN_EMAILS = adminEmails;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/user')) {
      return jsonResponse(200, {
        id: authId,
        email,
        app_metadata: { provider: 'email' },
        user_metadata: { name: 'Authenticated User' }
      });
    }
    if (options.method === 'GET') return jsonResponse(200, existing ? [existing] : []);
    const record = JSON.parse(options.body);
    return jsonResponse(200, [{ id: existing?.id || 1, ...record }]);
  };

  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer test-user-token' },
    body
  };
  const res = responseRecorder();
  await handler(req, res);
  return { res, calls };
}

test('normalizes the server admin allowlist', () => {
  assert.deepEqual(
    configuredAdminEmails(' Admin@Example.com,second@example.com ,, '),
    ['admin@example.com', 'second@example.com']
  );
});

test('rejects admin role requests from non-allowlisted users', async () => {
  const { res, calls } = await invoke({ body: { role: 'admin', profile: {} } });
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /server-allowlisted/i);
  assert.equal(calls.length, 1, 'no profile read or write should occur');
});

test('rejects privileged profile properties', async () => {
  const { res, calls } = await invoke({ body: { role: 'writer', profile: { is_admin: true } } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /server-managed/i);
  assert.equal(calls.length, 1, 'no profile read or write should occur');
});

test('sets identity fields from the verified session', async () => {
  const { res, calls } = await invoke({
    body: { email: 'USER@example.com', role: 'writer', name: 'Writer', profile: { bio: 'Hello' } }
  });
  assert.equal(res.statusCode, 200);
  const write = calls.find((call) => call.options.method === 'POST');
  const record = JSON.parse(write.options.body);
  assert.equal(record.email, 'user@example.com');
  assert.equal(record.auth_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(record.role, 'writer');
  assert.equal(record.is_admin, false);
  assert.equal(record.profile.auth_provider, 'email');
  assert.equal(record.profile.is_admin, undefined);
});

test('allowlisted accounts become admins regardless of requested self-service role', async () => {
  const { res, calls } = await invoke({
    body: { role: 'writer', profile: { bio: 'Admin bio' } },
    email: 'admin@example.com',
    adminEmails: 'admin@example.com'
  });
  assert.equal(res.statusCode, 200);
  const write = calls.find((call) => call.options.method === 'POST');
  const record = JSON.parse(write.options.body);
  assert.equal(record.role, 'admin');
  assert.equal(record.is_admin, true);
  assert.equal(record.profile.is_admin, true);
  assert.equal(record.profile.role_label, 'Platform Admin');
});

test('non-allowlisted legacy admin state is removed during a profile write', async () => {
  const existing = {
    id: 9,
    email: 'user@example.com',
    name: 'Legacy Admin',
    role: 'admin',
    is_admin: true,
    auth_id: '11111111-1111-4111-8111-111111111111',
    profile: { is_admin: true, role_label: 'Admin', bio: 'Bio' }
  };
  const { res, calls } = await invoke({ body: { profile: { bio: 'Updated' } }, existing });
  assert.equal(res.statusCode, 200);
  const write = calls.find((call) => call.options.method === 'PATCH');
  const record = JSON.parse(write.options.body);
  assert.equal(record.role, 'employer');
  assert.equal(record.is_admin, false);
  assert.equal(record.profile.is_admin, undefined);
  assert.equal(record.profile.role_label, undefined);
});
