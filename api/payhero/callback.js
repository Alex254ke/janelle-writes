import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const callbackSecret = process.env.PAYHERO_CALLBACK_SECRET;
  if (callbackSecret && req.query.secret !== callbackSecret) {
    return res.status(401).json({ error: 'Invalid callback secret' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server Supabase env vars missing' });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const payload = req.body || {};
  const response = payload.response || payload;

  const externalReference = response.ExternalReference || response.external_reference || response.user_reference || response.externalReference || '';
  const checkout = response.CheckoutRequestID || response.checkout_request_id || response.checkoutRequestID || '';
  const merchantRef = response.merchant_reference || response.MerchantRequestID || response.reference || '';
  const statusText = String(response.Status || response.status || payload.status || '').toUpperCase();
  const resultCode = response.ResultCode ?? response.result_code ?? response.resultCode;
  const success = payload.status === true || statusText === 'SUCCESS' || statusText === 'SUCCESSFUL' || resultCode === 0 || resultCode === '0';
  const receipt = response.MpesaReceiptNumber || response.mpesa_receipt || response.providerReference || response.provider_reference || response.receipt || null;
  const amount = Number(response.Amount || response.amount || 0);

  let query = admin.from('jw_payments').select('*').limit(1);
  if (externalReference) query = query.eq('external_reference', externalReference);
  else if (checkout) query = query.eq('checkout_request_id', checkout);
  else if (merchantRef) query = query.eq('payhero_reference', merchantRef);
  else {
    await admin.from('jw_payment_callbacks').insert([{ payload, processed: false }]).catch(() => {});
    return res.status(202).json({ received: true, matched: false, reason: 'Missing payment reference' });
  }

  const { data: rows, error: findError } = await query;
  if (findError || !rows?.length) {
    await admin.from('jw_payment_callbacks').insert([{ payload, external_reference: externalReference || null, checkout_request_id: checkout || null, processed: false }]).catch(() => {});
    return res.status(202).json({ received: true, matched: false });
  }

  const payment = rows[0];
  const update = {
    status: success ? 'SUCCESS' : (statusText || 'FAILED'),
    mpesa_receipt: receipt,
    callback_payload: payload,
    updated_at: new Date().toISOString()
  };

  await admin.from('jw_payments').update(update).eq('id', payment.id);

  if (success && (!amount || Number(payment.amount) === amount)) {
    await admin.from('jw_tasks').update({
      payment: 'paid',
      mpesa_code: receipt,
      payhero_reference: payment.payhero_reference || merchantRef || checkout || externalReference,
      paid_at: new Date().toISOString()
    }).eq('id', payment.task_id);
  }

  await admin.from('jw_payment_callbacks').insert([{ payload, external_reference: externalReference || null, checkout_request_id: checkout || null, payment_id: payment.id, processed: true }]).catch(() => {});
  return res.status(200).json({ received: true, matched: true, success });
}
