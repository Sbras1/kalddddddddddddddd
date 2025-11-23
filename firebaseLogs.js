// firebaseLogs.js
// مسؤول عن تسجيل العمليات في Realtime Database + استرجاع السجل

const admin = require("firebase-admin");

const dbUrl = process.env.FIREBASE_DB_URL || "";
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "";

let app = null;
let db = null;
let firebaseEnabled = false;

const MAX_LOGS_PER_TRADER = 1000; // نخزن آخر 1000 عملية لكل تاجر

function initFirebase() {
  if (firebaseEnabled) return;

  if (!dbUrl || !serviceAccountPath) {
    console.warn(
      "⚠️ Firebase غير مهيّأ (FIREBASE_DB_URL أو FIREBASE_SERVICE_ACCOUNT_PATH غير موجودة)، سيتم تعطيل السجل."
    );
    return;
  }

  try {
    const serviceAccount = require(serviceAccountPath);

    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: dbUrl
    });

    db = admin.database();
    firebaseEnabled = true;
    console.log("✅ Firebase logs مفعّلة.");
  } catch (err) {
    console.error("❌ فشل تهيئة Firebase:", err.message);
    firebaseEnabled = false;
  }
}

initFirebase();

/**
 * تسجيل عملية واحدة لتاجر معيّن
 * @param {number|string} userId
 * @param {object} data  مثل: {type:'check', code:'...', result:'success', ...}
 */
async function logOperation(userId, data) {
  if (!firebaseEnabled) return;

  try {
    const uid = String(userId);
    const ref = db.ref("logs").child(uid);

    const payload = {
      ...data,
      time: data.time || Date.now()
    };

    await ref.push().set(payload);
  } catch (err) {
    console.error("logOperation error:", err.message);
  }
}

/**
 * استرجاع سجل التاجر مع إحصائيات + تقسيم صفحات
 * @param {number|string} userId
 * @param {object} options  { type, page, pageSize }
 */
async function getTraderLogs(userId, options = {}) {
  const pageSize = Number(options.pageSize) || 20;
  const page = Number(options.page) || 1;
  const typeFilter = options.type || null;

  if (!firebaseEnabled) {
    return {
      items: [],
      page: 1,
      totalPages: 1,
      stats: {
        total: 0,
        check: 0,
        activate: 0,
        player: 0
      }
    };
  }

  try {
    const uid = String(userId);
    const ref = db
      .ref("logs")
      .child(uid)
      .orderByChild("time")
      .limitToLast(MAX_LOGS_PER_TRADER);

    const snap = await ref.once("value");

    const all = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      all.push({
        id: child.key,
        ...v
      });
    });

    // من الأقدم إلى الأحدث
    all.sort((a, b) => (a.time || 0) - (b.time || 0));

    // إحصائيات عامّة
    const stats = {
      total: all.length,
      check: 0,
      activate: 0,
      player: 0
    };

    for (const op of all) {
      if (op.type === "check") stats.check++;
      else if (op.type === "activate") stats.activate++;
      else if (op.type === "player") stats.player++;
    }

    let filtered = all;

    if (typeFilter) {
      filtered = all.filter((op) => op.type === typeFilter);
    }

    // نعرض من الأحدث إلى الأقدم
    filtered = filtered.slice().reverse();

    const totalPages = Math.max(
      1,
      Math.ceil(filtered.length / pageSize) || 1
    );
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;

    const items = filtered.slice(start, end);

    return {
      items,
      page: safePage,
      totalPages,
      stats
    };
  } catch (err) {
    console.error("getTraderLogs error:", err.message);
    return {
      items: [],
      page: 1,
      totalPages: 1,
      stats: {
        total: 0,
        check: 0,
        activate: 0,
        player: 0
      }
    };
  }
}

function isFirebaseEnabled() {
  return firebaseEnabled;
}

module.exports = {
  logOperation,
  getTraderLogs,
  isFirebaseEnabled
};
