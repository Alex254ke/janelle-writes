import { createClient } from '@supabase/supabase-js';

function cors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || 'https://www.janellewrites.it.com';
  const origin = req.headers.origin || '';
  if (origin === allowed || origin === 'https://janellewrites.it.com') res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function normalizePhone(phone) {
  const raw = String(phone || '').replace(/\s+/g, '').replace(/-/g, '');
  if (/^07\d{8}$/.test(raw)) return raw;
  if (/^2547\d{8}$/.test(raw)) return '0' + raw.slice(3);
  if (/^\+2547\d{8}$/.test(raw)) return '0' + raw.slice(4);
  return raw;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const payheroToken = process.env.PAYHERO_BASIC_AUTH_TOKEN;
  const channelId = Number(process.env.PAYHERO_CHANNEL_ID || 0);
  const callbackSecret = process.env.PAYHERO_CALLBACK_SECRET;
  const publicSiteUrl = (process.env.PUBLIC_SITE_URL || process.env.ALLOWED_ORIGIN || 'https://www.janellewrites.it.com').replace(/\/$/, '');

  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server Supabase env vars missing' });
  if (!payheroToken || !channelId) return res.status(500).json({ error: 'PayHero env vars missing' });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyError } = await admin.auth.getUser(token);
  if (verifyError || !verified?.user?.email) return res.status(401).json({ error: 'Invalid session' });

  const email = verified.user.email.toLowerCase();
  const { taskId, phone_number } = req.body || {};
  if (!taskId || !phone_number) return res.status(400).json({ error: 'taskId and phone_number are required' });

  const { data: userRow } = await admin.from('jw_users').select('email,name,role,is_admin').ilike('email', email).single();
  const isAdmin = userRow?.is_admin || email === 'janellewrites979@gmail.com';

  const { data: task, error: taskError } = await admin.from('jw_tasks').select('*').eq('id', taskId).single();
  if (taskError || !task) return res.status(404).json({ error: 'Order not found' });
  if (!isAdmin && String(task.posted_by || '').toLowerCase() !== email) return res.status(403).json({ error: 'Only the employer who posted this order can request payment' });
  if (task.payment === 'paid') return res.status(400).json({ error: 'This order is already marked paid' });

  const amount = Math.round(Number(task.total || 0));
  if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid order amount' });

  const externalReference = `${task.id}-${Date.now()}`;
  const callbackUrl = `${publicSiteUrl}/api/payhero/callback${callbackSecret ? `?secret=${encodeURIComponent(callbackSecret)}` : ''}`;

  const payload = {
    amount,
    phone_number: normalizePhone(phone_number),
    channel_id: channelId,
    provider: 'm-pesa',
    external_reference: externalReference,
    customer_name: task.posted_by_name || userRow?.name || email,
    callback_url: callbackUrl
  };

  const response = await fetch('https://backend.payhero.co.ke/api/v2/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${payheroToken}`
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    return res.status(response.status || 502).json({ error: body.message || body.error || 'PayHero STK request failed', details: body });
  }

  await admin.from('jw_payments').insert([{
    task_id: task.id,
    employer_email: task.posted_by || email,
    employer_name: task.posted_by_name || userRow?.name || null,
    amount,
    phone_number: payload.phone_number,
    provider: 'm-pesa',
    external_reference: externalReference,
    payhero_reference: body.reference || null,
    checkout_request_id: body.CheckoutRequestID || null,
    status: body.status || 'QUEUED',
    raw_response: body
  }]);

  return res.status(200).json({
    success: true,
    status: body.status || 'QUEUED',
    reference: body.reference || null,
    CheckoutRequestID: body.CheckoutRequestID || null,
    external_reference: externalReference
  });
}
