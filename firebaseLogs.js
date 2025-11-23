// firebaseLogs.js
// مسئول عن التسجيل في Firebase فقط

const admin = require("firebase-admin");

let db = null;
let firebaseReady = false;

function initFirebase() {
  if (firebaseReady && db) return db;

  const dbURL = process.env.FIREBASE_DB_URL;
  const serviceJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!dbURL || !serviceJson) {
    console.warn(
      "⚠️ Firebase غير مهيّأ: تأكد من FIREBASE_DB_URL و FIREBASE_SERVICE_ACCOUNT_JSON في المتغيّرات."
    );
    firebaseReady = false;
    return null;
  }

  let creds;
  try {
    creds = JSON.parse(serviceJson);
  } catch (err) {
    console.error(
      "❌ فشل تهيئة Firebase: JSON غير صالح في FIREBASE_SERVICE_ACCOUNT_JSON:",
      err.message
    );
    firebaseReady = false;
    return null;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(creds),
        databaseURL: dbURL,
      });
    }
    db = admin.database();
    firebaseReady = true;
    console.log("✅ Firebase Logs جاهزة للعمل.");
    return db;
  } catch (err) {
    console.error("❌ فشل تهيئة Firebase:", err.message);
    firebaseReady = false;
    return null;
  }
}

// تسجيل عملية واحدة
async function logOperation(userId, data) {
  const database = initFirebase();
  if (!database) {
    console.warn("⚠️ logOperation: Firebase غير متوفر حالياً.");
    return;
  }

  try {
    const uid = String(userId);
    const ref = database.ref(`logs/${uid}`).push();
    const time = Date.now();

    const payload = {
      time,
      ...data,
    };

    await ref.set(payload);
  } catch (err) {
    console.error("⚠️ logOperation: خطأ أثناء الحفظ في Firebase:", err.message);
  }
}

// قراءة سجلات تاجر معيّن مع ترقيم بسيط
async function getTraderLogs(userId, options = {}) {
  const database = initFirebase();
  if (!database) {
    console.warn("⚠️ getTraderLogs: Firebase غير متوفر حالياً.");
    return { items: [], total: 0 };
  }

  const uid = String(userId);
  const page = Number(options.page || 1);
  const pageSize = Number(options.pageSize || 20);

  try {
    const snapshot = await database
      .ref(`logs/${uid}`)
      .orderByChild("time")
      .once("value");

    const raw = snapshot.val() || {};
    const all = Object.values(raw).sort((a, b) => (a.time || 0) - (b.time || 0));
    const total = all.length;

    // نرجّع من الأحدث إلى الأقدم
    const start = Math.max(total - page * pageSize, 0);
    const end = total - (page - 1) * pageSize;
    const pageItems = all.slice(start, end).reverse();

    return {
      items: pageItems,
      total,
    };
  } catch (err) {
    console.error("⚠️ getTraderLogs: خطأ أثناء القراءة من Firebase:", err.message);
    return { items: [], total: 0 };
  }
}

module.exports = {
  logOperation,
  getTraderLogs,
};
