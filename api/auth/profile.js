const DEFAULT_ADMIN_EMAIL = 'janellewrites979@gmail.com';

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(status).json(body);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (['admin', 'student', 'employer', 'writer'].includes(r)) return r;
  return 'employer';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeText(value, max = 120) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
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
  if (!authRes.ok || !authBody?.email) {
    return sendJson(res, 401, { error: 'Invalid or expired user session.' });
  }

  let parsedBody = req.body;
  if (typeof parsedBody === 'string') {
    try { parsedBody = JSON.parse(parsedBody || '{}'); } catch { parsedBody = {}; }
  }
  const payload = safeObject(parsedBody);
  const email = normalizeEmail(authBody.email);
  const requestedEmail = normalizeEmail(payload.email);
  if (requestedEmail && requestedEmail !== email) {
    return sendJson(res, 403, { error: 'Profile email does not match the signed-in user.' });
  }

  const adminEmails = String(process.env.JW_ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL)
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
  const isAdmin = adminEmails.includes(email);

  const selectUrl = `${supabaseUrl}/rest/v1/jw_users?email=eq.${encodeURIComponent(email)}&select=*`;
  const existingRes = await supabaseFetch(selectUrl, serviceKey, { method: 'GET' });
  const existingRows = await readJsonResponse(existingRes);
  if (!existingRes.ok) {
    return sendJson(res, existingRes.status, { error: 'Could not read user profile.', details: existingRows });
  }

  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const existingProfile = safeObject(existing?.profile);
  const incomingProfile = safeObject(payload.profile);
  const name = sanitizeText(
    payload.name ||
    existing?.name ||
    existingProfile.name ||
    authBody.user_metadata?.name ||
    authBody.user_metadata?.full_name ||
    email.split('@')[0]
  );
  const role = isAdmin ? 'admin' : (existing?.role || normalizeRole(payload.role || authBody.user_metadata?.role));
  const profile = {
    ...existingProfile,
    ...incomingProfile,
    name: sanitizeText(incomingProfile.name || existingProfile.name || name),
    auth_id: authBody.id,
    auth_provider: incomingProfile.auth_provider || existingProfile.auth_provider || authBody.app_metadata?.provider || 'email',
    updated_at: new Date().toISOString()
  };

  const record = {
    email,
    name,
    role,
    auth_id: authBody.id,
    profile
  };
  if (isAdmin) {
    record.is_admin = true;
    record.role = 'admin';
    record.profile = {
      ...record.profile,
      is_admin: true,
      role_label: 'Platform Admin',
      title: 'Platform Admin'
    };
  } else if (payload.is_admin === true) {
    record.is_admin = false;
  }

  const writeUrl = existing
    ? `${supabaseUrl}/rest/v1/jw_users?email=eq.${encodeURIComponent(email)}`
    : `${supabaseUrl}/rest/v1/jw_users`;
  const writeRes = await supabaseFetch(writeUrl, serviceKey, {
    method: existing ? 'PATCH' : 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(record)
  });
  const writeBody = await readJsonResponse(writeRes);
  if (!writeRes.ok) {
    return sendJson(res, writeRes.status, { error: 'Could not save user profile.', details: writeBody });
  }

  const user = Array.isArray(writeBody) ? writeBody[0] : writeBody;
  return sendJson(res, 200, { user });
}
