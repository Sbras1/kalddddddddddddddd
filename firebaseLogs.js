// ==================================================
// 🔥 Firebase Logs helper
// مسؤول عن:
//  - logOperation(userId, payload)
//  - getTraderLogs(userId, { type, limit })
// ==================================================

require("dotenv").config();
const admin = require("firebase-admin");

let db = null;
let firebaseReady = false;

function initFirebase() {
  if (firebaseReady) return db;

  const dbUrl = (process.env.FIREBASE_DB_URL || "").trim();
  const saPath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();

  if (!dbUrl || !saPath) {
    console.warn(
      "⚠️ Firebase غير مهيّأ: تأكد من FIREBASE_DB_URL و FIREBASE_SERVICE_ACCOUNT_PATH في .env"
    );
    return null;
  }

  try {
    const serviceAccount = require(saPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: dbUrl,
    });

    db = admin.database();
    firebaseReady = true;
    console.log("✅ Firebase Realtime Database جاهز للسجلات.");
    return db;
  } catch (err) {
    console.error("❌ فشل تهيئة Firebase:", err.message);
    return null;
  }
}

function getDb() {
  if (!db) {
    return initFirebase();
  }
  return db;
}

// ==================================================
// 📝 logOperation
// يسجل عملية لتاجر معيّن
// payload: { type, code, player_id, player_name, amount, activated_to, activated_at, result, ... }
// ==================================================
async function logOperation(userId, payload) {
  try {
    const database = getDb();
    if (!database) {
      // لا نوقف البوت لو في مشكلة
      console.warn("⚠️ logOperation: Firebase غير متوفر حالياً.");
      return;
    }

    const uid = String(userId);
    const ref = database.ref("logs").child(uid);

    const data = {
      ...payload,
      time: payload.time || Date.now(),
    };

    await ref.push(data);
  } catch (err) {
    console.error("⚠️ logOperation error:", err.message);
  }
}

// ==================================================
// 📚 getTraderLogs(userId, { type, limit })
// يرجع:
//  { items: [...], stats: { check: n, activate: n, player: n } }
// ==================================================
async function getTraderLogs(userId, options = {}) {
  const typeFilter = options.type || null; // "check" | "activate" | "player" | null
  const limit = options.limit || 500; // أعلى عدد نسحبه

  const result = {
    items: [],
    stats: {
      check: 0,
      activate: 0,
      player: 0,
    },
  };

  try {
    const database = getDb();
    if (!database) {
      console.warn("⚠️ getTraderLogs: Firebase غير متوفر.");
      return result;
    }

    const uid = String(userId);
    const ref = database
      .ref("logs")
      .child(uid)
      .orderByChild("time")
      .limitToLast(limit);

    const snap = await ref.once("value");
    if (!snap.exists()) return result;

    const tmp = [];
    snap.forEach((child) => {
      const val = child.val();
      if (!val || typeof val !== "object") return;

      const t = val.type || "";
      if (t === "check") result.stats.check += 1;
      else if (t === "activate") result.stats.activate += 1;
      else if (t === "player") result.stats.player += 1;

      tmp.push({ id: child.key, ...val });
    });

    // من الأحدث للأقدم
    tmp.sort((a, b) => (b.time || 0) - (a.time || 0));

    if (typeFilter) {
      result.items = tmp.filter((x) => x.type === typeFilter);
    } else {
      result.items = tmp;
    }

    return result;
  } catch (err) {
    console.error("⚠️ getTraderLogs error:", err.message);
    return result;
  }
}

module.exports = {
  logOperation,
  getTraderLogs,
};
