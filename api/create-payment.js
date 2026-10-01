const { db, verifyBearer, cashfreeRequest, normalizePhone, json } = require("./_lib/arena");
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const decoded = await verifyBearer(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: "A valid 10-digit Indian mobile number is required." });

    // Cashfree order_id is limited to 50 characters. Firebase UIDs are
    // already long, so do not embed the UID here. Keep the order ID short
    // and unique, while storing the Firebase UID separately in Firestore.
    const orderId = `arena_pro_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const returnUrl = `${origin}/?payment=return&order_id={order_id}`;
    const notifyUrl = `${origin}/api/cashfree-webhook`;

    const order = await cashfreeRequest("/pg/orders", {
      method: "POST",
      body: JSON.stringify({
        order_amount: 149,
        order_currency: "INR",
        order_id: orderId,
        customer_details: {
          customer_id: decoded.uid,
          customer_name: decoded.name || "Arena user",
          customer_email: decoded.email || "",
          customer_phone: phone
        },
        order_meta: {
          return_url: returnUrl,
          notify_url: notifyUrl
        },
        order_note: "Arena Pro - 30 Days"
      })
    });

    await db().collection("paymentOrders").doc(orderId).set({
      uid: decoded.uid,
      plan: "pro_30d",
      amount: 149,
      currency: "INR",
      status: "CREATED",
      cashfreeOrderId: orderId,
      customerPhone: phone,
      createdAt: new Date()
    });

    return json(res, 200, {
      order_id: orderId,
      payment_session_id: order.payment_session_id
    });
  } catch (err) {
    console.error("create-payment error", err);
    return json(res, err.statusCode || 500, { error: err.message || "Could not create payment order." });
  }
};
