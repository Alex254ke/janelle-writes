const DEFAULT_SITE_URL = 'https://www.janellewrites.it.com';
const DEFAULT_ADMIN_EMAIL = 'janellewrites979@gmail.com';

function cors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || DEFAULT_SITE_URL;
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

function json(res, status, body) {
  res.status(status).json(body);
}

function safeBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function normalizePhone(phone) {
  const raw = String(phone || '').replace(/[\s-]/g, '');
  if (/^07\d{8}$/.test(raw) || /^01\d{8}$/.test(raw)) return '254' + raw.slice(1);
  if (/^2547\d{8}$/.test(raw) || /^2541\d{8}$/.test(raw)) return raw;
  if (/^\+2547\d{8}$/.test(raw) || /^\+2541\d{8}$/.test(raw)) return raw.slice(1);
  return raw;
}

function maskPhone(phone) {
  const value = String(phone || '');
  return value.length > 6 ? value.slice(0, 5) + '***' + value.slice(-2) : 'hidden';
}

function darajaBaseUrl() {
  return String(process.env.DARAJA_ENV || 'sandbox').toLowerCase() === 'live'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function darajaTimestamp() {
  const eat = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/\D/g, '').slice(0, 14);
}

function shortAccountReference(taskId) {
  const clean = String(taskId || '').replace(/[^a-z0-9]/gi, '').slice(-9);
  return `JW${clean || Date.now().toString().slice(-9)}`.slice(0, 12);
}

async function readJson(response) {
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

async function supabaseSelectOne(supabaseUrl, serviceKey, table, query) {
  const response = await supabaseFetch(`${supabaseUrl}/rest/v1/${table}?${query}&limit=1`, serviceKey);
  const body = await readJson(response);
  if (!response.ok) return { error: body };
  return { data: Array.isArray(body) ? body[0] : null };
}

async function verifySession(supabaseUrl, serviceKey, token) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + token }
  });
  const body = await readJson(response);
  if (!response.ok || !body?.email) return null;
  return body;
}

async function getDarajaToken(baseUrl, consumerKey, consumerSecret) {
  const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
    }
  });
  const body = await readJson(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.errorMessage || body?.error_description || body?.error || 'Daraja token request failed');
  }
  return body.access_token;
}

function publicDarajaError(body) {
  return body?.errorMessage || body?.ResponseDescription || body?.responseDescription || body?.error || 'Unable to send M-Pesa STK push';
}

function darajaHint(message) {
  if (/invalid\s+businessshortcode/i.test(String(message || ''))) {
    return 'If DARAJA_ENV is sandbox, use Safaricom sandbox shortcode 174379 with the sandbox passkey. If this is a real PayBill/Till, set DARAJA_ENV=live and use live Daraja credentials approved for that shortcode.';
  }
  return undefined;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json(res, 401, { error: 'Missing session token' });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const consumerKey = String(process.env.DARAJA_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.DARAJA_CONSUMER_SECRET || '').trim();
  const shortcode = String(process.env.DARAJA_SHORTCODE || process.env.DARAJA_BUSINESS_SHORT_CODE || '').trim();
  const passkey = String(process.env.DARAJA_PASSKEY || '').trim();
  const callbackSecret = process.env.DARAJA_CALLBACK_SECRET;
  const publicSiteUrl = (process.env.PUBLIC_SITE_URL || process.env.ALLOWED_ORIGIN || DEFAULT_SITE_URL).replace(/\/$/, '');

  if (!supabaseUrl || !serviceKey) return json(res, 500, { error: 'Server Supabase env vars missing' });
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    return json(res, 500, { error: 'Daraja env vars missing. Add DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, and DARAJA_PASSKEY in Vercel.' });
  }
  if (!callbackSecret) return json(res, 500, { error: 'DARAJA_CALLBACK_SECRET is missing in Vercel' });

  const body = safeBody(req);
  const taskId = String(body.taskId || '').trim();
  const phone = normalizePhone(body.phone_number);
  if (!taskId || !phone) return json(res, 400, { error: 'taskId and phone_number are required' });
  if (!/^254(7|1)\d{8}$/.test(phone)) return json(res, 400, { error: 'Enter a valid Safaricom M-Pesa number, for example 07XXXXXXXX or 2547XXXXXXXX.' });

  const verified = await verifySession(supabaseUrl, serviceKey, token);
  if (!verified?.email) return json(res, 401, { error: 'Invalid session' });
  const email = String(verified.email || '').toLowerCase();

  const userResult = await supabaseSelectOne(
    supabaseUrl,
    serviceKey,
    'jw_users',
    `select=email,name,role,is_admin&email=ilike.${encodeURIComponent(email)}`
  );
  const userRow = userResult.data || {};
  const adminEmails = String(process.env.JW_ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL).toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
  const isAdmin = !!userRow.is_admin || adminEmails.includes(email);

  const taskResult = await supabaseSelectOne(
    supabaseUrl,
    serviceKey,
    'jw_tasks',
    `select=*&id=eq.${encodeURIComponent(taskId)}`
  );
  const task = taskResult.data;
  if (!task) return json(res, 404, { error: 'Order not found' });
  if (!isAdmin && String(task.posted_by || '').toLowerCase() !== email) {
    return json(res, 403, { error: 'Only the employer who posted this order can request payment' });
  }
  if (task.payment === 'paid') return json(res, 400, { error: 'This order is already marked paid' });
  if (String(task.status || '').toLowerCase() === 'cancelled') return json(res, 400, { error: 'Cancelled orders cannot be paid' });

  const amount = Math.round(Number(task.total || 0));
  if (!amount || amount < 1) return json(res, 400, { error: 'Invalid order amount' });

  const baseUrl = darajaBaseUrl();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const externalReference = `${task.id}-${Date.now()}`;
  const callbackUrl = `${publicSiteUrl}/api/daraja/callback?secret=${encodeURIComponent(callbackSecret)}`;

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: process.env.DARAJA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: process.env.DARAJA_PARTY_B || shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: shortAccountReference(task.id),
    TransactionDesc: `Janelle Writes order ${task.id}`
  };

  try {
    const accessToken = await getDarajaToken(baseUrl, consumerKey, consumerSecret);
    const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const darajaBody = await readJson(response);

    if (!response.ok || String(darajaBody?.ResponseCode || '') !== '0') {
      console.error('Daraja STK failed', {
        httpStatus: response.status,
        darajaBody,
        sentPayload: { ...payload, PhoneNumber: maskPhone(payload.PhoneNumber), PartyA: maskPhone(payload.PartyA), Password: 'hidden' }
      });
      const message = publicDarajaError(darajaBody);
      return json(res, response.status || 502, { error: message, hint: darajaHint(message), daraja_status: response.status });
    }

    const paymentRow = {
      task_id: task.id,
      employer_email: task.posted_by || email,
      employer_name: task.posted_by_name || userRow.name || null,
      amount,
      phone_number: phone,
      provider: 'daraja',
      external_reference: externalReference,
      checkout_request_id: darajaBody.CheckoutRequestID || null,
      status: 'QUEUED',
      raw_response: darajaBody
    };

    const insertResponse = await supabaseFetch(`${supabaseUrl}/rest/v1/jw_payments`, serviceKey, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(paymentRow)
    });
    const insertBody = await readJson(insertResponse);
    if (!insertResponse.ok) {
      console.error('Daraja payment record insert failed after STK accepted', insertBody);
      return json(res, 500, { error: 'STK was accepted, but the payment record could not be saved. Check jw_payments columns before testing live payments.' });
    }

    return json(res, 200, {
      success: true,
      status: 'QUEUED',
      reference: darajaBody.MerchantRequestID || darajaBody.CheckoutRequestID || externalReference,
      checkout_request_id: darajaBody.CheckoutRequestID || null,
      external_reference: externalReference
    });
  } catch (err) {
    console.error('Daraja STK error', err);
    return json(res, 502, { error: err.message || 'Unable to send M-Pesa STK push' });
  }
}
