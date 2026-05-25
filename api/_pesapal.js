const LIVE_BASE = 'https://pay.pesapal.com/v3';
const SANDBOX_BASE = 'https://cybqa.pesapal.com/pesapalv3';

function getBaseUrl() {
  const custom = process.env.PESAPAL_BASE_URL;
  if (custom) return custom.replace(/\/$/, '');
  return (process.env.PESAPAL_ENV || '').toLowerCase() === 'sandbox' ? SANDBOX_BASE : LIVE_BASE;
}

function getOrigin(req) {
  const configured = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (configured) {
    const withProto = configured.startsWith('http') ? configured : `https://${configured}`;
    return withProto.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function pesapalFetch(path, options = {}) {
  const base = getBaseUrl();
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || data?.error || `Pesapal HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getPesapalToken() {
  const consumer_key = process.env.PESAPAL_CONSUMER_KEY;
  const consumer_secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!consumer_key || !consumer_secret) {
    throw new Error('Missing PESAPAL_CONSUMER_KEY or PESAPAL_CONSUMER_SECRET environment variables.');
  }

  const data = await pesapalFetch('/api/Auth/RequestToken', {
    method: 'POST',
    body: JSON.stringify({ consumer_key, consumer_secret })
  });

  const token = data.token || data.access_token;
  if (!token) throw new Error('Pesapal did not return an auth token.');
  return token;
}

async function getOrRegisterIpnId(req, token) {
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;

  const origin = getOrigin(req);
  const url = process.env.PESAPAL_IPN_URL || `${origin}/api/pesapal-ipn`;

  const data = await pesapalFetch('/api/URLSetup/RegisterIPN', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      url,
      ipn_notification_type: process.env.PESAPAL_IPN_TYPE || 'GET'
    })
  });

  const id = data.ipn_id || data.notification_id;
  if (!id) throw new Error('Pesapal did not return an IPN ID. Register IPN manually and set PESAPAL_IPN_ID.');
  return id;
}

function normalizePhone(phone) {
  let raw = String(phone || '').trim().replace(/[^\d+]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('0') && raw.length >= 10) return '+254' + raw.slice(1);
  if (raw.startsWith('254')) return '+' + raw;
  return raw;
}

function splitName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || 'Janelle',
    last_name: parts.slice(1).join(' ') || 'Writes'
  };
}

function buildBillingAddress({ email, phone, name, countryCode = 'KE' }) {
  const n = splitName(name || email || 'Janelle Writes');
  return {
    email_address: email || 'support@janellewrites.it.com',
    phone_number: normalizePhone(phone),
    country_code: countryCode,
    first_name: n.first_name,
    last_name: n.last_name,
    line_1: 'Janelle Writes',
    city: 'Nairobi',
    state: 'Kenya',
    postal_code: '00100',
    zip_code: '00100'
  };
}

async function submitOrderRequest(req, payload) {
  const token = await getPesapalToken();
  const notification_id = await getOrRegisterIpnId(req, token);

  const origin = getOrigin(req);
  const merchantReference = payload.merchantReference || `JW-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const amount = Number(payload.amount);
  if (!amount || amount < 1) throw new Error('Invalid amount.');

  const currency = payload.currency || 'KES';
  const description = payload.description || `Janelle Writes payment ${currency} ${amount}`;
  const callback_url = payload.callback_url || `${origin}/?pesapal=callback&ref=${encodeURIComponent(merchantReference)}`;

  const order = {
    id: merchantReference,
    currency,
    amount,
    description,
    callback_url,
    notification_id,
    billing_address: buildBillingAddress({
      email: payload.email,
      phone: payload.phone,
      name: payload.name,
      countryCode: payload.countryCode || 'KE'
    })
  };

  // Some Pesapal accounts/channels support direct request-to-pay/STK style flows.
  // If unavailable, fall back to the standard hosted checkout order request.
  const attempts = [];
  for (const endpoint of ['/api/Transactions/RequestToPay', '/api/Transactions/SubmitOrderRequest']) {
    try {
      const data = await pesapalFetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(order)
      });
      return {
        ...data,
        method: endpoint.includes('RequestToPay') ? 'request_to_pay' : 'checkout',
        merchant_reference: data.merchant_reference || merchantReference,
        order_tracking_id: data.order_tracking_id || data.orderTrackingId || data.tracking_id || '',
        redirect_url: data.redirect_url || data.redirectUrl || ''
      };
    } catch (err) {
      attempts.push({ endpoint, error: err.message, details: err.data || null });
      // Continue to fallback endpoint.
    }
  }

  const e = new Error('Pesapal payment request failed on both RequestToPay and SubmitOrderRequest.');
  e.details = attempts;
  throw e;
}

async function getTransactionStatus(orderTrackingId) {
  const token = await getPesapalToken();
  if (!orderTrackingId) throw new Error('Missing orderTrackingId.');
  return await pesapalFetch(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function updateWalletFromStatus({ merchantReference, orderTrackingId, statusData }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !merchantReference) {
    return { skipped: true, reason: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or merchantReference.' };
  }

  const paymentStatus = String(statusData.payment_status_description || statusData.payment_status || statusData.status || '').toLowerCase();
  let status = 'pending_review';
  if (paymentStatus.includes('completed') || paymentStatus.includes('paid') || paymentStatus.includes('success')) status = 'approved';
  if (paymentStatus.includes('failed') || paymentStatus.includes('invalid') || paymentStatus.includes('reversed')) status = 'rejected';

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/jw_wallet_transactions?tx_ref=eq.${encodeURIComponent(merchantReference)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      status,
      code: orderTrackingId || statusData.order_tracking_id || statusData.confirmation_code || statusData.payment_method || null,
      reviewed_by: 'pesapal',
      reviewed_at: status === 'approved' || status === 'rejected' ? new Date().toISOString() : null,
      metadata: {
        provider: 'pesapal',
        order_tracking_id: orderTrackingId || statusData.order_tracking_id || '',
        status_response: statusData
      }
    })
  });

  const text = await response.text();
  if (!response.ok) {
    return { skipped: false, error: text || `Supabase HTTP ${response.status}` };
  }
  try { return { skipped: false, data: JSON.parse(text) }; } catch { return { skipped: false, data: text }; }
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

module.exports = {
  getBaseUrl,
  getOrigin,
  getPesapalToken,
  getOrRegisterIpnId,
  submitOrderRequest,
  getTransactionStatus,
  updateWalletFromStatus,
  sendJson
};
