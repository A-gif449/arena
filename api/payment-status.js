import { db, verifyBearer, getSuccessfulPayments, activateSubscription, json } from "./_lib/arena.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  try {
    const decoded = await verifyBearer(req);
    const orderId = String(req.query.order_id || "");
    if (!orderId) return json(res, 400, { error: "Missing order_id." });

    const snap = await db().collection("paymentOrders").doc(orderId).get();
    if (!snap.exists || snap.data().uid !== decoded.uid) return json(res, 404, { error: "Payment order not found." });

    const order = snap.data();
    if (order.status === "PAID") {
      const sub = await db().collection("subscriptions").doc(decoded.uid).get();
      const data = sub.exists ? sub.data() : {};
      return json(res, 200, {
        status: "PAID",
        active: data.status === "active" && data.expiresAt?.toDate?.() > new Date(),
        expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || null
      });
    }

    const payments = await getSuccessfulPayments(orderId);
    const success = payments.some(p => p && p.payment_status === "SUCCESS");
    if (!success) return json(res, 200, { status: payments[0]?.payment_status || "PENDING", active: false });

    const activated = await activateSubscription(orderId);
    return json(res, 200, { status: "PAID", active: true, expiresAt: activated.expiresAt });
  } catch (err) {
    console.error("payment-status error", err);
    return json(res, err.statusCode || 500, { error: err.message || "Could not verify payment." });
  }
};

