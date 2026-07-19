const SELF_SERVICE_ROLES = new Set(['student', 'employer', 'writer']);
const SAFE_USER_COLUMNS = 'id,email,name,role,created_at,profile,auth_id,updated_at,is_admin';
const FORBIDDEN_TOP_LEVEL_KEYS = new Set([
  'id',
  'auth_id',
  'is_admin',
  'created_at',
  'updated_at'
]);
const PRIVILEGED_PROFILE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'admin',
  'app_metadata',
  'auth_id',
  'auth_provider',
  'claims',
  'email',
  'id',
  'is_admin',
  'permissions',
  'role',
  'role_label',
  'user_id',
  'user_metadata',
  'updated_at'
]);

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(status).json(body);
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function requestedSelfServiceRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return SELF_SERVICE_ROLES.has(normalized) ? normalized : null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeText(value, max = 120) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function ownForbiddenKey(value, forbiddenKeys) {
  return Object.keys(safeObject(value)).find((key) => forbiddenKeys.has(key));
}

function withoutPrivilegedProfileKeys(value) {
  return Object.fromEntries(
    Object.entries(safeObject(value)).filter(([key]) => !PRIVILEGED_PROFILE_KEYS.has(key))
  );
}

export function configuredAdminEmails(envValue = process.env.JW_ADMIN_EMAILS) {
  return String(envValue || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

async function readJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function supabaseFetch(url, serviceKey, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ughwzaowgpergpizenko.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return sendJson(res, 500, { error: 'Supabase service configuration is missing.' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(res, 401, { error: 'Missing authorization token.' });

  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + token
    }
  });
  const authBody = await readJsonResponse(authRes);
  if (!authRes.ok || !authBody?.email || !authBody?.id) {
    return sendJson(res, 401, { error: 'Invalid or expired user session.' });
  }

  let parsedBody = req.body;
  if (typeof parsedBody === 'string') {
    try { parsedBody = JSON.parse(parsedBody || '{}'); } catch { parsedBody = {}; }
  }
  const payload = safeObject(parsedBody);
  const forbiddenTopLevelKey = ownForbiddenKey(payload, FORBIDDEN_TOP_LEVEL_KEYS);
  if (forbiddenTopLevelKey) {
    return sendJson(res, 400, { error: `Profile property "${forbiddenTopLevelKey}" is server-managed.` });
  }

  const incomingProfile = safeObject(payload.profile);
  const forbiddenProfileKey = ownForbiddenKey(incomingProfile, PRIVILEGED_PROFILE_KEYS);
  if (forbiddenProfileKey) {
    return sendJson(res, 400, { error: `Profile property "${forbiddenProfileKey}" is server-managed.` });
  }

  const email = normalizeEmail(authBody.email);
  const requestedEmail = normalizeEmail(payload.email);
  if (requestedEmail && requestedEmail !== email) {
    return sendJson(res, 403, { error: 'Profile email does not match the signed-in user.' });
  }

  const requestedRole = String(payload.role || '').trim().toLowerCase();
  const isAdmin = configuredAdminEmails().includes(email);
  if (requestedRole === 'admin' && !isAdmin) {
    return sendJson(res, 403, { error: 'Administrator access is restricted to server-allowlisted accounts.' });
  }
  if (requestedRole && requestedRole !== 'admin' && !SELF_SERVICE_ROLES.has(requestedRole)) {
    return sendJson(res, 400, { error: 'Invalid account role.' });
  }

  const selectUrl = `${supabaseUrl}/rest/v1/jw_users?email=eq.${encodeURIComponent(email)}&select=${SAFE_USER_COLUMNS}`;
  const existingRes = await supabaseFetch(selectUrl, serviceKey, { method: 'GET' });
  const existingRows = await readJsonResponse(existingRes);
  if (!existingRes.ok) {
    return sendJson(res, existingRes.status, { error: 'Could not read user profile.' });
  }

  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const existingProfile = withoutPrivilegedProfileKeys(existing?.profile);
  const name = sanitizeText(
    payload.name ||
    existing?.name ||
    existingProfile.name ||
    authBody.user_metadata?.name ||
    authBody.user_metadata?.full_name ||
    email.split('@')[0]
  );

  let role;
  if (isAdmin) {
    role = 'admin';
  } else if (existing?.role && SELF_SERVICE_ROLES.has(String(existing.role).toLowerCase())) {
    role = String(existing.role).toLowerCase();
  } else {
    role = requestedSelfServiceRole(requestedRole || authBody.user_metadata?.role) || 'employer';
  }

  const profile = {
    ...existingProfile,
    ...incomingProfile,
    name: sanitizeText(incomingProfile.name || existingProfile.name || name),
    auth_id: authBody.id,
    auth_provider: existing?.profile?.auth_provider || authBody.app_metadata?.provider || 'email',
    updated_at: new Date().toISOString()
  };

  const record = {
    email,
    name,
    role,
    auth_id: authBody.id,
    is_admin: isAdmin,
    profile
  };

  if (isAdmin) {
    record.profile = {
      ...record.profile,
      is_admin: true,
      role_label: 'Platform Admin',
      title: 'Platform Admin'
    };
  }

  const writeUrl = existing
    ? `${supabaseUrl}/rest/v1/jw_users?email=eq.${encodeURIComponent(email)}&select=${SAFE_USER_COLUMNS}`
    : `${supabaseUrl}/rest/v1/jw_users?select=${SAFE_USER_COLUMNS}`;
  const writeRes = await supabaseFetch(writeUrl, serviceKey, {
    method: existing ? 'PATCH' : 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(record)
  });
  const writeBody = await readJsonResponse(writeRes);
  if (!writeRes.ok) {
    return sendJson(res, writeRes.status, { error: 'Could not save user profile.' });
  }

  const user = Array.isArray(writeBody) ? writeBody[0] : writeBody;
  return sendJson(res, 200, { user });
}
