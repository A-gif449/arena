const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

function adminApp() {
  if (getApps().length) return getApps()[0];

  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    throw new Error("Firebase Admin environment variables are missing.");
  }

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

function db() {
  return getFirestore(adminApp());
}

function auth() {
  return getAuth(adminApp());
}

async function verifyBearer(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    const err = new Error("Missing Authorization bearer token.");
    err.statusCode = 401;
    throw err;
  }
  return auth().verifyIdToken(header.slice(7));
}

function cashfreeBaseUrl() {
  return String(process.env.CASHFREE_ENV || "sandbox").toLowerCase() === "production"
    ? "https://api.cashfree.com"
    : "https://sandbox.cashfree.com";
}

function cashfreeHeaders() {
  if (!process.env.CASHFREE_CLIENT_ID || !process.env.CASHFREE_CLIENT_SECRET) {
    throw new Error("Cashfree environment variables are missing.");
  }
  return {
    "x-client-id": process.env.CASHFREE_CLIENT_ID,
    "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
    "x-api-version": "2025-01-01",
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
}

async function cashfreeRequest(path, options = {}) {
  const response = await fetch(cashfreeBaseUrl() + path, {
    ...options,
    headers: { ...cashfreeHeaders(), ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    const err = new Error(data.message || data.error || `Cashfree request failed (${response.status}).`);
    err.statusCode = response.status;
    err.cashfree = data;
    throw err;
  }
  return data;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  // Cashfree Create Order expects an Indian 10-digit customer phone
  // number without the +91 country-code prefix.
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return "";
}

function json(res, status, payload) {
  res.status(status).setHeader("Cache-Control", "no-store");
  return res.json(payload);
}

async function getSuccessfulPayments(orderId) {
  const data = await cashfreeRequest(`/pg/orders/${encodeURIComponent(orderId)}/payments`, { method: "GET" });
  return Array.isArray(data) ? data : [];
}

async function activateSubscription(orderId) {
  const firestore = db();
  const orderRef = firestore.collection("paymentOrders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    const err = new Error("Arena payment order was not found.");
    err.statusCode = 404;
    throw err;
  }

  const order = orderSnap.data();
  if (Number(order.amount) !== 149 || order.plan !== "pro_30d") {
    const err = new Error("Payment order does not match the Arena Pro plan.");
    err.statusCode = 400;
    throw err;
  }

  const subRef = firestore.collection("subscriptions").doc(order.uid);
  const result = await firestore.runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    const freshSub = await tx.get(subRef);
    const freshOrderData = freshOrder.data() || {};
    const freshSubData = freshSub.exists ? freshSub.data() : {};

    if (freshOrderData.status === "PAID" && freshSubData.lastOrderId === orderId) {
      return {
        alreadyActive: true,
        expiresAt: freshSubData.expiresAt?.toDate?.()?.toISOString?.() || null
      };
    }

    const now = new Date();
    let start = now;
    const existingExpiry = freshSubData.expiresAt?.toDate?.();
    if (freshSubData.status === "active" && existingExpiry && existingExpiry.getTime() > now.getTime()) {
      start = existingExpiry;
    }
    const expires = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);

    tx.set(subRef, {
      uid: order.uid,
      plan: "pro_30d",
      status: "active",
      startsAt: Timestamp.fromDate(start),
      expiresAt: Timestamp.fromDate(expires),
      amount: 149,
      currency: "INR",
      provider: "cashfree",
      lastOrderId: orderId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    tx.set(orderRef, {
      status: "PAID",
      paidAt: FieldValue.serverTimestamp(),
      activatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { alreadyActive: false, expiresAt: expires.toISOString() };
  });

  return { ...result, uid: order.uid };
}

module.exports = {
  adminApp,
  db,
  auth,
  verifyBearer,
  cashfreeRequest,
  normalizePhone,
  json,
  getSuccessfulPayments,
  activateSubscription
};
