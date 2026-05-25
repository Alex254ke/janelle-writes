const { getPesapalToken, getOrRegisterIpnId, getOrigin, sendJson } = require('./_pesapal');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret) {
      const provided = req.headers['x-admin-secret'] || req.query?.admin_secret;
      if (provided !== adminSecret) return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const token = await getPesapalToken();
    const ipn_id = await getOrRegisterIpnId(req, token);
    return sendJson(res, 200, {
      ok: true,
      ipn_id,
      ipn_url: process.env.PESAPAL_IPN_URL || `${getOrigin(req)}/api/pesapal-ipn`,
      message: 'Copy this ipn_id into Vercel as PESAPAL_IPN_ID for faster future requests.'
    });
  } catch (err) {
    console.error('Pesapal register IPN error:', err);
    return sendJson(res, err.status || 500, { error: err.message || 'Could not register IPN', details: err.data || null });
  }
};
