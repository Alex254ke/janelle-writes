import { createClient } from '@supabase/supabase-js';

const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX = 20;
const memoryBuckets = new Map();

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

async function rateLimit(req, key) {
  const now = Date.now();
  const id = `profile:${key}:${getIp(req)}`;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const bucketKey = encodeURIComponent(`jw_rl:${id}:${Math.floor(now / RL_WINDOW_MS)}`);
    const pipeline = [
      ['INCR', bucketKey],
      ['PEXPIRE', bucketKey, RL_WINDOW_MS]
    ];

    const response = await fetch(`${redisUrl}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline)
    });

    if (!response.ok) return { ok: true, remaining: 1 };
    const result = await response.json();
    const count = Number(result?.[0]?.result || 0);
    return { ok: count <= RL_MAX, remaining: Math.max(0, RL_MAX - count) };
  }

  const bucket = (memoryBuckets.get(id) || []).filter(ts => now - ts < RL_WINDOW_MS);
  if (bucket.length >= RL_MAX) return { ok: false, remaining: 0 };
  bucket.push(now);
  memoryBuckets.set(id, bucket);
  return { ok: true, remaining: RL_MAX - bucket.length };
}

function cors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || 'https://www.janellewrites.it.com';
  const origin = req.headers.origin || '';
  if (origin === allowed || origin === 'https://janellewrites.it.com') {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowed);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sanitizeRole(role) {
  return role === 'writer' ? 'writer' : 'employer';
}

function sanitizeText(value, max = 120) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  const rl = await rateLimit(req, token.slice(-16));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server auth is not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: verified, error: verifyError } = await admin.auth.getUser(token);
  if (verifyError || !verified?.user?.email) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const authUser = verified.user;
  const email = String(authUser.email).toLowerCase();
  const body = req.body || {};
  if (body.email && String(body.email).toLowerCase() !== email) {
    return res.status(403).json({ error: 'Email mismatch' });
  }

  const name = sanitizeText(body.name || authUser.user_metadata?.name || authUser.user_metadata?.full_name || email.split('@')[0]);
  const role = sanitizeRole(body.role || authUser.user_metadata?.role);
  const incomingProfile = typeof body.profile === 'object' && body.profile ? body.profile : {};
  const profile = {
    ...incomingProfile,
    name,
    auth_provider: authUser.app_metadata?.provider || incomingProfile.auth_provider || 'email',
    updated_at: new Date().toISOString()
  };

  const payload = { email, auth_id: authUser.id, name, role, profile };

  const { data, error } = await admin
    .from('jw_users')
    .upsert(payload, { onConflict: 'email' })
    .select('id,email,name,role,profile')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ user: data });
}
