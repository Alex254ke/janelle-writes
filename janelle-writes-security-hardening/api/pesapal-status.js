
const LIVE_BASE = 'https://pay.pesapal.com/v3';
const SANDBOX_BASE = 'https://cybqa.pesapal.com/pesapalv3';

const json = (status, data) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }
});

const baseUrl = () => (process.env.PESAPAL_BASE_URL || ((process.env.PESAPAL_ENV || '').toLowerCase() === 'sandbox' ? SANDBOX_BASE : LIVE_BASE)).replace(/\/$/, '');

function origin(request) {
  const configured = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (configured) return (configured.startsWith('http') ? configured : `https://${configured}`).replace(/\/$/, '');
  return new URL(request.url).origin.replace(/\/$/, '');
}

async function pesapal(path, options = {}) {
  const r = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { Accept:'application/json', 'Content-Type':'application/json', ...(options.headers || {}) }
  });
  const raw = await r.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!r.ok || data?.error) {
    const e = new Error(data?.error?.message || data?.message || data?.error || data?.raw || `Pesapal HTTP ${r.status}`);
    e.status = r.status; e.data = data; throw e;
  }
  return data;
}

async function token() {
  const consumer_key = process.env.PESAPAL_CONSUMER_KEY;
  const consumer_secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!consumer_key || !consumer_secret) throw new Error('Missing PESAPAL_CONSUMER_KEY or PESAPAL_CONSUMER_SECRET in Vercel.');
  const data = await pesapal('/api/Auth/RequestToken', { method:'POST', body: JSON.stringify({ consumer_key, consumer_secret }) });
  if (!data.token) throw new Error('Pesapal did not return token. Check keys and PESAPAL_ENV.');
  return data.token;
}

async function ensureIpn(request, bearer) {
  if (process.env.PESAPAL_IPN_ID) return { ipn_id: process.env.PESAPAL_IPN_ID, reused: true };
  const ipnUrl = process.env.PESAPAL_IPN_URL || `${origin(request)}/api/pesapal-ipn`;
  if (!/^https:\/\//i.test(ipnUrl)) throw new Error('PESAPAL_IPN_URL must be a public HTTPS URL.');
  const data = await pesapal('/api/URLSetup/RegisterIPN', {
    method:'POST',
    headers:{ Authorization:`Bearer ${bearer}` },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: process.env.PESAPAL_IPN_TYPE || 'GET' })
  });
  if (!data.ipn_id) throw new Error('Pesapal did not return ipn_id.');
  return data;
}

const safeRef = ref => String(ref || `JW-${Date.now()}`).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 50);
function names(name='') {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first_name:p[0] || 'Janelle', last_name:p.slice(1).join(' ') || 'Writes' };
}
function cleanPhone(phone='') {
  let raw = String(phone).trim().replace(/[^\d+]/g, '');
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('254')) return '+' + raw;
  return raw;
}

async function submitOrder(request, payload) {
  const bearer = await token();
  const ipn = await ensureIpn(request, bearer);
  const amount = Number(payload.amount);
  if (!amount || amount < 1) throw new Error('Invalid amount.');
  const n = names(payload.name || payload.email);
  const merchantReference = safeRef(payload.merchantReference);
  const body = {
    id: merchantReference,
    currency: payload.currency || 'KES',
    amount,
    description: String(payload.description || `Janelle Writes wallet top-up`).slice(0, 100),
    callback_url: payload.callback_url || `${origin(request)}/?pesapal=callback&OrderMerchantReference=${encodeURIComponent(merchantReference)}`,
    notification_id: ipn.ipn_id,
    branch: 'Janelle Writes',
    billing_address: {
      email_address: payload.email || 'support@janellewrites.it.com',
      phone_number: cleanPhone(payload.phone),
      country_code: payload.countryCode || 'KE',
      first_name: n.first_name,
      last_name: n.last_name,
      line_1: 'Janelle Writes',
      line_2: '',
      city: 'Nairobi',
      state: '',
      postal_code: '',
      zip_code: ''
    }
  };
  const data = await pesapal('/api/Transactions/SubmitOrderRequest', {
    method:'POST',
    headers:{ Authorization:`Bearer ${bearer}` },
    body: JSON.stringify(body)
  });
  if (!data.redirect_url) throw new Error(data.message || 'Pesapal did not return redirect_url.');
  return { ok:true, method:'checkout', merchant_reference:data.merchant_reference || merchantReference, order_tracking_id:data.order_tracking_id || '', redirect_url:data.redirect_url, ipn_id:ipn.ipn_id };
}

async function status(orderTrackingId) {
  const bearer = await token();
  if (!orderTrackingId) throw new Error('Missing OrderTrackingId.');
  return await pesapal(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, {
    method:'GET',
    headers:{ Authorization:`Bearer ${bearer}` }
  });
}

async function updateWallet({ merchantReference, orderTrackingId, statusData }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !merchantReference) return { skipped:true, reason:'Supabase service variables or merchantReference missing.' };
  const desc = String(statusData.payment_status_description || statusData.payment_status || statusData.status || '').toLowerCase();
  let rowStatus = 'pending_review';
  if (desc.includes('completed') || desc.includes('paid') || desc.includes('success')) rowStatus = 'approved';
  if (desc.includes('failed') || desc.includes('invalid') || desc.includes('reversed')) rowStatus = 'rejected';
  const r = await fetch(`${supabaseUrl.replace(/\/$/,'')}/rest/v1/jw_wallet_transactions?tx_ref=eq.${encodeURIComponent(merchantReference)}`, {
    method:'PATCH',
    headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json', Prefer:'return=representation' },
    body: JSON.stringify({ status: rowStatus, code: orderTrackingId || null, reviewed_by:'pesapal', reviewed_at:['approved','rejected'].includes(rowStatus) ? new Date().toISOString() : null, metadata:{ provider:'pesapal', order_tracking_id:orderTrackingId || '', status_response:statusData } })
  });
  const text = await r.text();
  if (!r.ok) return { skipped:false, error:text || `Supabase HTTP ${r.status}` };
  try { return { skipped:false, data:JSON.parse(text) }; } catch { return { skipped:false, data:text }; }
}

export default {
  async fetch(request) {
    try {
      const u = new URL(request.url);
      const orderTrackingId = u.searchParams.get('OrderTrackingId') || u.searchParams.get('orderTrackingId') || u.searchParams.get('order_tracking_id');
      const merchantReference = u.searchParams.get('OrderMerchantReference') || u.searchParams.get('merchantReference') || u.searchParams.get('merchant_reference');
      const s = await status(orderTrackingId);
      const wallet = await updateWallet({ merchantReference, orderTrackingId, statusData:s });
      return json(200, { ok:true, status:s, wallet });
    } catch (err) {
      console.error('Pesapal status error:', err);
      return json(500, { error:err.message || 'Could not check status.', details:err.data || null });
    }
  }
};
