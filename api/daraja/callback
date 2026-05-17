const DEFAULT_SITE_URL = 'https://www.janellewrites.it.com';

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

async function selectPayment(supabaseUrl, serviceKey, checkoutRequestId, merchantRequestId) {
  const rest = `${supabaseUrl}/rest/v1/jw_payments?select=*&limit=1`;
  let response = null;
  if (checkoutRequestId) {
    response = await supabaseFetch(`${rest}&checkout_request_id=eq.${encodeURIComponent(checkoutRequestId)}`, serviceKey);
    const body = await readJson(response);
    if (response.ok && Array.isArray(body) && body.length) return body[0];
  }
  if (merchantRequestId) {
    response = await supabaseFetch(`${rest}&payhero_reference=eq.${encodeURIComponent(merchantRequestId)}`, serviceKey);
    const body = await readJson(response);
    if (response.ok && Array.isArray(body) && body.length) return body[0];
  }
  return null;
}

function callbackValue(stk, name) {
  const items = stk?.CallbackMetadata?.Item || stk?.callbackMetadata?.Item || [];
  const found = items.find(item => String(item.Name || item.name || '').toLowerCase() === name.toLowerCase());
  return found?.Value ?? found?.value ?? null;
}

function commissionFor(amount) {
  const gross = Number(amount || 0);
  const rate = Number(process.env.JW_COMMISSION_RATE || 0.12);
  const commission = Math.round(gross * rate);
  return { rate, commission, payout: Math.max(0, gross - commission) };
}

async function insertCallbackLog(supabaseUrl, serviceKey, row) {
  await supabaseFetch(`${supabaseUrl}/rest/v1/jw_payment_callbacks`, serviceKey, {
    method: 'POST',
    body: JSON.stringify(row)
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const callbackSecret = process.env.DARAJA_CALLBACK_SECRET;
  if (!callbackSecret) {
    console.error('DARAJA_CALLBACK_SECRET is missing; refusing callback.');
    return json(res, 500, { error: 'Payment callback is not configured' });
  }
  if (req.query.secret !== callbackSecret) return json(res, 401, { error: 'Invalid callback secret' });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(res, 500, { error: 'Server Supabase env vars missing' });

  const payload = safeBody(req);
  const stk = payload?.Body?.stkCallback || payload?.body?.stkCallback || payload?.stkCallback || payload;
  const checkoutRequestId = stk.CheckoutRequestID || stk.checkoutRequestID || stk.checkout_request_id || '';
  const merchantRequestId = stk.MerchantRequestID || stk.merchantRequestID || stk.merchant_request_id || '';
  const resultCode = stk.ResultCode ?? stk.resultCode ?? stk.result_code;
  const success = String(resultCode) === '0';
  const receipt = callbackValue(stk, 'MpesaReceiptNumber');
  const amount = Number(callbackValue(stk, 'Amount') || 0);

  if (!checkoutRequestId && !merchantRequestId) {
    await insertCallbackLog(supabaseUrl, serviceKey, { payload, processed: false });
    return json(res, 202, { received: true, matched: false, reason: 'Missing Daraja reference' });
  }

  const payment = await selectPayment(supabaseUrl, serviceKey, checkoutRequestId, merchantRequestId);
  if (!payment) {
    await insertCallbackLog(supabaseUrl, serviceKey, {
      payload,
      checkout_request_id: checkoutRequestId || null,
      processed: false
    });
    return json(res, 202, { received: true, matched: false });
  }

  const paymentStatus = success ? 'SUCCESS' : 'FAILED';
  await supabaseFetch(`${supabaseUrl}/rest/v1/jw_payments?id=eq.${encodeURIComponent(payment.id)}`, serviceKey, {
    method: 'PATCH',
    body: JSON.stringify({
      status: paymentStatus,
      mpesa_receipt: receipt,
      callback_payload: payload,
      updated_at: new Date().toISOString()
    })
  });

  const expectedAmount = Number(payment.amount || 0);
  const amountMatches = Number.isFinite(amount) && amount > 0 && Number.isFinite(expectedAmount) && expectedAmount === amount;

  if (success && amountMatches) {
    const commission = commissionFor(expectedAmount);
    const taskUpdate = {
      payment: 'paid',
      mpesa_code: receipt,
      paid_at: new Date().toISOString(),
      commission_rate: commission.rate,
      commission_amount: commission.commission,
      writer_payout: commission.payout,
      commission_paid: true
    };
    await supabaseFetch(`${supabaseUrl}/rest/v1/jw_tasks?id=eq.${encodeURIComponent(payment.task_id)}`, serviceKey, {
      method: 'PATCH',
      body: JSON.stringify(taskUpdate)
    });
  } else if (success && !amountMatches) {
    console.warn('Daraja callback success did not mark task paid because amount did not match', {
      payment_id: payment.id,
      task_id: payment.task_id,
      expectedAmount,
      callbackAmount: amount || null
    });
  }

  await insertCallbackLog(supabaseUrl, serviceKey, {
    payload,
    checkout_request_id: checkoutRequestId || null,
    payment_id: payment.id,
    processed: true
  });

  return json(res, 200, {
    received: true,
    matched: true,
    success,
    paid: success && amountMatches
  });
}
