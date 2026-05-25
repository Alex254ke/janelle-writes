const { getTransactionStatus, updateWalletFromStatus, sendJson } = require('./_pesapal');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const orderTrackingId = req.query.orderTrackingId || req.query.OrderTrackingId || req.query.order_tracking_id;
    const merchantReference = req.query.merchantReference || req.query.OrderMerchantReference || req.query.merchant_reference;

    if (!orderTrackingId) return sendJson(res, 400, { error: 'orderTrackingId is required.' });

    const status = await getTransactionStatus(orderTrackingId);
    const wallet = await updateWalletFromStatus({ merchantReference, orderTrackingId, statusData: status });

    return sendJson(res, 200, { ok: true, status, wallet });
  } catch (err) {
    console.error('Pesapal status error:', err);
    return sendJson(res, err.status || 500, { error: err.message || 'Could not check status', details: err.data || null });
  }
};
