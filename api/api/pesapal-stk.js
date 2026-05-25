const { submitOrderRequest, sendJson } = require('./_pesapal');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');

    const amount = Number(body.amount);
    if (!amount || amount < 1) return sendJson(res, 400, { error: 'Enter a valid amount.' });
    if (!body.phone) return sendJson(res, 400, { error: 'Phone number is required.' });
    if (!body.email) return sendJson(res, 400, { error: 'User email is required.' });

    const data = await submitOrderRequest(req, body);
    return sendJson(res, 200, {
      ok: true,
      ...data
    });
  } catch (err) {
    console.error('Pesapal STK/order error:', err);
    return sendJson(res, err.status || 500, {
      error: err.message || 'Pesapal payment request failed.',
      details: err.details || err.data || null
    });
  }
};
