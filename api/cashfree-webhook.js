const crypto = require("crypto");
const getRawBody = require("raw-body");
const { getSuccessfulPayments, activateSubscription, json } = require("./_lib/arena");

module.exports.config = { api: { bodyParser: false } };

function validSignature(rawBody, signature, timestamp) {
  if (!signature || !timestamp || !process.env.CASHFREE_CLIENT_SECRET) return false;
  const expected = crypto.createHmac("sha256", process.env.CASHFREE_CLIENT_SECRET)
    .update(String(timestamp) + rawBody)
    .digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); }
  catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const raw = (await getRawBody(req)).toString("utf8");
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];
    if (!validSignature(raw, signature, timestamp)) return json(res, 401, { error: "Invalid webhook signature." });

    const payload = JSON.parse(raw);
    const orderId = payload?.data?.order?.order_id || payload?.data?.order?.orderId;
    const paymentStatus = payload?.data?.payment?.payment_status;
    if (!orderId) return json(res, 200, { received: true });

    // Confirm the order with Cashfree instead of trusting webhook JSON alone.
    const payments = await getSuccessfulPayments(orderId);
    const success = payments.some(p => p && p.payment_status === "SUCCESS");
    if (success || paymentStatus === "SUCCESS") {
      await activateSubscription(orderId);
    }

    return json(res, 200, { received: true });
  } catch (err) {
    console.error("cashfree-webhook error", err);
    return json(res, err.statusCode || 500, { error: err.message || "Webhook processing failed." });
  }
};
