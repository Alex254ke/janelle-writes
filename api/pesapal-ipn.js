const { getTransactionStatus, updateWalletFromStatus, sendJson } = require('./_pesapal');

module.exports = async function handler(req, res) {
  try {
    const q = req.query || {};
    const body = typeof req.body === 'object' && req.body ? req.body : {};

    const orderTrackingId =
      q.OrderTrackingId || q.orderTrackingId || q.order_tracking_id ||
      body.OrderTrackingId || body.orderTrackingId || body.order_tracking_id;

    const merchantReference =
      q.OrderMerchantReference || q.merchantReference || q.merchant_reference ||
      body.OrderMerchantReference || body.merchantReference || body.merchant_reference;

    if (!orderTrackingId) {
      return sendJson(res, 200, { ok: true, message: 'IPN received without order tracking id.' });
    }

    const status = await getTransactionStatus(orderTrackingId);
    const wallet = await updateWalletFromStatus({ merchantReference, orderTrackingId, statusData: status });

    return sendJson(res, 200, {
      orderNotificationType: q.OrderNotificationType || q.orderNotificationType || body.OrderNotificationType || 'IPNCHANGE',
      orderTrackingId,
      orderMerchantReference: merchantReference || '',
      status: 200,
      wallet
    });
  } catch (err) {
    console.error('Pesapal IPN error:', err);
    return sendJson(res, 200, { ok: false, error: err.message || 'IPN handled with error' });
  }
};
