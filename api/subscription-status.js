const { db, verifyBearer, json } = require("./_lib/arena");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
  try {
    const decoded = await verifyBearer(req);
    const snap = await db().collection("subscriptions").doc(decoded.uid).get();
    if (!snap.exists) return json(res, 200, { active: false, expiresAt: null, plan: null });
    const data = snap.data();
    const expires = data.expiresAt?.toDate?.() || null;
    const active = data.status === "active" && expires && expires.getTime() > Date.now();
    return json(res, 200, {
      active: !!active,
      plan: active ? data.plan : null,
      expiresAt: expires ? expires.toISOString() : null
    });
  } catch (err) {
    console.error("subscription-status error", err);
    return json(res, err.statusCode || 500, { error: err.message || "Could not load subscription." });
  }
};
