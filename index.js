// index.js
// 🤖 PUBG Trader Bot — Midasbuy + Firebase Logs + Traders

require("dotenv").config();

const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const {
  logOperation,
  getTraderLogs,
  isFirebaseEnabled
} = require("./firebaseLogs");

// ============ إعدادات البيئة ============

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const API_KEY = (process.env.API_KEY || "").trim();
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

const API_BASE_URL = (
  process.env.API_BASE_URL || "https://midasbuy-api.com/api/v1/pubg"
).replace(/\/+$/, "");

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود في .env");
  process.exit(1);
}
if (!API_KEY) {
  console.error("❌ API_KEY غير موجود في .env");
  process.exit(1);
}
if (!OWNER_ID) {
  console.warn("⚠️ OWNER_ID غير محدد، أوامر إدارة التجّار لن تعمل.");
}

if (!isFirebaseEnabled()) {
  console.warn("⚠️ Firebase logs غير مفعّلة (سيعمل البوت بدون سجل).");
}

// ============ ملف التجّار ============

const TRADERS_FILE = "traders.json";
let traders = {};

function loadTraders() {
  try {
    if (fs.existsSync(TRADERS_FILE)) {
      const raw = fs.readFileSync(TRADERS_FILE, "utf8").trim();
      traders = raw ? JSON.parse(raw) : {};
    } else {
      traders = {};
      fs.writeFileSync(TRADERS_FILE, JSON.stringify(traders, null, 2), "utf8");
    }
  } catch (err) {
    console.error("⚠️ خطأ أثناء تحميل traders.json:", err.message);
    traders = {};
  }
}

function saveTraders() {
  try {
    fs.writeFileSync(TRADERS_FILE, JSON.stringify(traders, null, 2), "utf8");
  } catch (err) {
    console.error("⚠️ خطأ أثناء حفظ traders.json:", err.message);
  }
}

function isTrader(userId) {
  if (!userId) return false;
  if (OWNER_ID && Number(userId) === OWNER_ID) return true;
  return Boolean(traders[userId]);
}

loadTraders();

// ============ إنشاء البوت ============

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let botUsername = null;

bot
  .getMe()
  .then((me) => {
    botUsername = me.username;
    console.log(`🤖 البوت يعمل: @${botUsername}`);
  })
  .catch((err) => {
    console.error("⚠️ خطأ getMe:", err.message);
  });

// ============ إدارة الجلسات ============

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {});
  }
  return sessions.get(chatId);
}

function resetSession(chatId) {
  sessions.set(chatId, {});
}

// ============ دوال مساعدة ============

function isDigits(text) {
  return /^[0-9]+$/.test((text || "").trim());
}

function formatDateTimeFromUnix(unixOrMs) {
  if (!unixOrMs && unixOrMs !== 0) return "-";
  let ms = Number(unixOrMs);
  if (ms < 1e12) ms = ms * 1000;
  const d = new Date(ms);
  return d.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour12: true
  });
}

function formatNow() {
  return formatDateTimeFromUnix(Date.now());
}

async function apiPost(endpoint, body, label) {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`🔗 ${label || "API"} URL:`, url);
  console.log(`📦 ${label || "API"} body:`, body);

  const res = await axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      Accept: "application/json"
    },
    timeout: 15000
  });

  return res.data;
}

// ============ استدعاءات Midasbuy ============

async function getPlayerInfo(playerId) {
  return apiPost(
    "/getPlayer",
    { player_id: Number(playerId) },
    "getPlayer"
  );
}

async function checkUcCode(ucCode) {
  return apiPost(
    "/checkCode",
    { uc_code: ucCode, show_time: true },
    "checkCode"
  );
}

async function activateUcCode(playerId, ucCode) {
  return apiPost(
    "/activate",
    { player_id: Number(playerId), uc_code: ucCode },
    "activate"
  );
}

// ============ لوحة الأزرار ============

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["👤 حسابي"],
        ["🎮 استعلام عن لاعب", "🧪 فحص كود"],
        ["⚡ تفعيل كود", "📒 سجلي"],
        ["💳 الاشتراك"]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

async function sendMainMenu(chatId) {
  await bot.sendMessage(chatId, "اختر من القائمة أدناه:", mainMenuKeyboard());
}

// ============ أوامر إدارة التجّار (للـ OWNER) ============

// /اضف_تاجر   (بالرد على التاجر أو مع ID)
bot.onText(/^\/اضف_تاجر(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  let targetId = null;
  let targetUsername = null;
  let targetName = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    const u = msg.reply_to_message.from;
    targetId = u.id;
    targetUsername = u.username ? `@${u.username}` : null;
    targetName =
      [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
  }

  if (!targetId && match && match[1]) {
    const arg = match[1].trim();
    if (isDigits(arg)) {
      targetId = Number(arg);
    }
  }

  if (!targetId) {
    return bot.sendMessage(
      chatId,
      "⚠️ طريقة الاستخدام:\n" +
        "1) بالرد على رسالة التاجر: /اضف_تاجر\n" +
        "أو\n" +
        "2) مع ID مباشر: /اضف_تاجر 123456789"
    );
  }

  const now = Date.now();
  const defaultDays = 30;
  const accessUntil = now + defaultDays * 24 * 60 * 60 * 1000;

  const prev = traders[targetId] || {};

  traders[targetId] = {
    username: targetUsername || prev.username || null,
    name: targetName || prev.name || null,
    addedBy: fromId,
    registered_at: prev.registered_at || now,
    access_until: accessUntil,
    send_logs: true
  };

  saveTraders();

  let txt = "✅ تم إضافة/تحديث التاجر.\n";
  txt += `• ID: ${targetId}\n`;
  if (traders[targetId].username) {
    txt += `• يوزر: ${traders[targetId].username}\n`;
  }
  if (traders[targetId].name) {
    txt += `• الاسم: ${traders[targetId].name}\n`;
  }
  txt += `• تاريخ التسجيل: ${formatDateTimeFromUnix(
    traders[targetId].registered_at
  )}\n`;
  txt += `• الاشتراك حتى: ${formatDateTimeFromUnix(accessUntil)}\n`;

  await bot.sendMessage(chatId, txt);
});

// /حذف_تاجر
bot.onText(/^\/حذف_تاجر(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  let targetId = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    targetId = msg.reply_to_message.from.id;
  }

  if (!targetId && match && match[1]) {
    const arg = match[1].trim();
    if (isDigits(arg)) targetId = Number(arg);
  }

  if (!targetId) {
    return bot.sendMessage(
      chatId,
      "⚠️ استخدم الأمر هكذا:\n" +
        "• بالرد على رسالة التاجر: /حذف_تاجر\n" +
        "أو\n" +
        "• مع ID: /حذف_تاجر 123456789"
    );
  }

  if (!traders[targetId]) {
    return bot.sendMessage(chatId, "ℹ️ هذا ID غير موجود في قائمة التجّار.");
  }

  delete traders[targetId];
  saveTraders();

  await bot.sendMessage(chatId, `✅ تم حذف التاجر.\n• ID: ${targetId}`);
});

// /قائمة_التجار
bot.onText(/^\/قائمة_التجار$/i, async (msg) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  const entries = Object.entries(traders);
  if (!entries.length) {
    return bot.sendMessage(chatId, "لا يوجد تجّار مسجّلين حاليًا.");
  }

  let t = `📋 قائمة التجّار (${entries.length}):\n\n`;
  for (const [id, info] of entries) {
    t += `• ID: ${id}`;
    if (info.username) t += ` — ${info.username}`;
    if (info.name) t += ` — ${info.name}`;
    if (info.access_until) {
      t += ` — اشتراك حتى: ${formatDateTimeFromUnix(info.access_until)}`;
    }
    t += "\n";
  }

  await bot.sendMessage(chatId, t, { disable_web_page_preview: true });
});

// ============ أوامر عامة: /start /سجلي /حسابي /الاشتراك ============

async function handleSubscriptionInfo(chatId) {
  const txt =
    "💳 تفاصيل الاشتراك في بوت التاجر:\n\n" +
    "• 49 ريال / شهر — تاجر واحد\n" +
    "  يشمل:\n" +
    "  – استعلام اللاعبين بالـ ID\n" +
    "  – فحص أكواد UC\n" +
    "  – تفعيل الأكواد على حسابات العملاء\n" +
    "  – عرض سجل عملياتك من داخل البوت\n\n" +
    "للاشتراك أو الاستفسار:\n" +
    "• راسل مالك البوت على تيليجرام: @" +
    (botUsername || "YOUR_USERNAME");

  await bot.sendMessage(chatId, txt, { disable_web_page_preview: true });
}

async function handleShowLogsSummary(chatId, userId) {
  const { stats } = await getTraderLogs(userId, {
    page: 1,
    pageSize: 1
  });

  const checkCount = stats.check || 0;
  const activateCount = stats.activate || 0;
  const playerCount = stats.player || 0;

  const txt =
    "📊 سجلك في البوت:\n\n" +
    `• عدد استعلامات اللاعبين: ${playerCount}\n` +
    `• عدد فحوصات الأكواد: ${checkCount}\n` +
    `• عدد تفعيل الأكواد: ${activateCount}\n\n` +
    "اختر نوع السجل الذي تريد استعراضه:";

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🎮 استعراض استعلام اللاعبين",
            callback_data: "logs:player:1"
          }
        ],
        [
          {
            text: "🧪 استعراض فحص الأكواد",
            callback_data: "logs:check:1"
          }
        ],
        [
          {
            text: "⚡ استعراض تفعيل الأكواد",
            callback_data: "logs:activate:1"
          }
        ]
      ]
    }
  };

  await bot.sendMessage(chatId, txt, keyboard);
}

async function handleMyAccount(chatId, userId) {
  const info = traders[userId];

  if (!info) {
    return bot.sendMessage(
      chatId,
      "⚠️ حسابك غير مضاف كتاجر.\nتواصل مع مالك البوت للاشتراك.",
      mainMenuKeyboard()
    );
  }

  const registeredAt = info.registered_at
    ? formatDateTimeFromUnix(info.registered_at)
    : "-";
  const accessUntil = info.access_until
    ? formatDateTimeFromUnix(info.access_until)
    : "-";

  let status = "غير مشترك";
  if (info.access_until && info.access_until > Date.now()) {
    status = "مشترك ✅";
  } else {
    status = "غير نشط / منتهي ❌";
  }

  const { stats } = await getTraderLogs(userId, {
    page: 1,
    pageSize: 1
  });

  const checkCount = stats.check || 0;
  const activateCount = stats.activate || 0;
  const playerCount = stats.player || 0;

  let txt = "👤 حسابي كتاجر PUBG:\n\n";
  txt += `• ID: ${userId}\n`;
  if (info.username) txt += `• Username: ${info.username}\n`;
  if (info.name) txt += `• الاسم: ${info.name}\n`;
  txt += `• حالة الاشتراك: ${status}\n`;
  txt += `• تاريخ التسجيل: ${registeredAt}\n`;
  txt += `• الاشتراك حتى: ${accessUntil}\n\n`;
  txt += "📊 إحصائيات سريعة:\n";
  txt += `• استعلامات اللاعبين: ${playerCount}\n`;
  txt += `• فحوصات الأكواد: ${checkCount}\n`;
  txt += `• تفعيل الأكواد: ${activateCount}\n`;

  await bot.sendMessage(chatId, txt, mainMenuKeyboard());
}

// /start
bot.onText(/^\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  resetSession(chatId);

  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "يمكنك مشاهدة الأزرار، لكن استخدام المزايا يحتاج اشتراك كتاجر.\n\n" +
      "استخدم زر (💳 الاشتراك) لمعرفة تفاصيل الاشتراك.";
    await bot.sendMessage(chatId, txt, mainMenuKeyboard());
    return;
  }

  let welcome = "أهلاً بك في بوت تاجر PUBG 💳\n\n";
  welcome += "يمكنك عبر هذا البوت:\n";
  welcome += "• استعلام عن اسم اللاعب عن طريق الـ ID.\n";
  welcome += "• فحص أكواد UC ومعرفة حالتها.\n";
  welcome += "• تفعيل أكواد UC على حساب اللاعب.\n";
  welcome += "• استعراض سجلك من داخل البوت.\n";

  await bot.sendMessage(chatId, welcome, mainMenuKeyboard());
});

// /سجلي
bot.onText(/^\/سجلي$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isTrader(userId)) {
    return bot.sendMessage(
      chatId,
      "⚠️ هذه الميزة للتجّار فقط.\nاستخدم زر (💳 الاشتراك) لمعرفة التفاصيل."
    );
  }

  await handleShowLogsSummary(chatId, userId);
});

// /حسابي
bot.onText(/^\/حسابي$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await handleMyAccount(chatId, userId);
});

// /الاشتراك
bot.onText(/^\/الاشتراك$/i, async (msg) => {
  const chatId = msg.chat.id;
  await handleSubscriptionInfo(chatId);
});

// ============ التعامل مع الأزرار النصيّة (الكيبورد) ============

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  if (!text) return;

  // الأوامر ( /start /سجلي إلخ ) يعالجها onText فوق
  if (text.startsWith("/")) return;

  const session = getSession(chatId);

  // زر الاشتراك
  if (text === "💳 الاشتراك") {
    await handleSubscriptionInfo(chatId);
    return;
  }

  // زر حسابي
  if (text === "👤 حسابي") {
    await handleMyAccount(chatId, userId);
    return;
  }

  // زر سجلي
  if (text === "📒 سجلي") {
    if (!isTrader(userId)) {
      return bot.sendMessage(
        chatId,
        "⚠️ هذه الميزة للتجّار فقط.\nاستخدم زر (💳 الاشتراك) لمعرفة التفاصيل."
      );
    }
    await handleShowLogsSummary(chatId, userId);
    return;
  }

  // باقي المزايا للتجّار فقط
  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "لا يمكنك استخدام هذه الميزة قبل الاشتراك كتاجر.\n\n" +
      "استخدم زر (💳 الاشتراك) لمعرفة التفاصيل.";
    await bot.sendMessage(chatId, txt);
    return;
  }

  // زر استعلام لاعب
  if (text === "🎮 استعلام عن لاعب") {
    session.mode = "WAIT_PLAYER_LOOKUP_ID";
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب (أرقام فقط) لعرض الاسم."
    );
    return;
  }

  // زر فحص كود
  if (text === "🧪 فحص كود") {
    session.mode = "WAIT_CHECK_CODE";
    await bot.sendMessage(
      chatId,
      "أرسل الآن كود UC المراد فحصه (انسخه كامل بدون مسافات زائدة)."
    );
    return;
  }

  // زر تفعيل كود
  if (text === "⚡ تفعيل كود") {
    session.mode = "WAIT_ACTIVATE_PLAYER_ID";
    session.temp = {};
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب الذي تريد تفعيل الكود له (أرقام فقط)."
    );
    return;
  }

  // -------- أوضاع التفاعل --------

  // استعلام لاعب
  if (session.mode === "WAIT_PLAYER_LOOKUP_ID") {
    if (!isDigits(text)) {
      return bot.sendMessage(
        chatId,
        "⚠️ ID غير صالح.\nأرسل أرقام فقط بدون مسافات."
      );
    }

    const playerId = text;

    try {
      await bot.sendMessage(chatId, "⏳ يتم الاستعلام عن اللاعب ...");

      const data = await getPlayerInfo(playerId);

      if (!data.success || !data.data || data.data.status !== "success") {
        await bot.sendMessage(
          chatId,
          "⚠️ لم يتم العثور على اللاعب.\nتأكد من الـ ID وحاول مرة أخرى."
        );

        await logOperation(userId, {
          type: "player",
          player_id: playerId,
          player_name: null,
          result: "not_found"
        });
      } else {
        const p = data.data;
        const reply =
          "👤 بيانات اللاعب:\n" +
          `• ID: ${p.player_id}\n` +
          `• الاسم: ${p.player_name}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "player",
          player_id: p.player_id,
          player_name: p.player_name,
          result: "success"
        });
      }
    } catch (err) {
      console.error("خطأ getPlayer:", err.message);
      await bot.sendMessage(
        chatId,
        "❌ حدث خطأ أثناء الاستعلام عن اللاعب. جرّب لاحقًا."
      );
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }

    return;
  }

  // فحص كود
  if (session.mode === "WAIT_CHECK_CODE") {
    const ucCode = text;

    try {
      await bot.sendMessage(chatId, "⏳ يتم فحص الكود ...");

      const data = await checkUcCode(ucCode);
      const nowStr = formatNow();

      if (!data.success || !data.data) {
        await bot.sendMessage(
          chatId,
          "❌ تعذر فحص الكود حاليًا. حاول مرة أخرى لاحقًا."
        );

        await logOperation(userId, {
          type: "check",
          code: ucCode,
          result: "error"
        });
      } else {
        const d = data.data;
        const status = d.status || "unknown";
        const amount = d.amount || "-";
        const activatedTo = d.activated_to || "-";
        const activatedAtStr = d.activated_at
          ? formatDateTimeFromUnix(d.activated_at)
          : "-";

        if (status === "activated") {
          const reply =
            "✅ الكود مُفعّل\n" +
            `• الكود: ${d.uc_code}\n` +
            `• الكمية: ${amount} UC\n` +
            `• تم التفعيل على ID: ${activatedTo}\n` +
            `• وقت التفعيل: ${activatedAtStr}\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: d.uc_code,
            amount,
            activated_to: activatedTo,
            activated_at: d.activated_at || null,
            result: "activated"
          });
        } else if (status === "unactivated") {
          const reply =
            "ℹ️ الكود غير مفعّل\n" +
            `• الكود: ${d.uc_code}\n` +
            `• الكمية: ${amount} UC\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: d.uc_code,
            amount,
            result: "unactivated"
          });
        } else {
          const reply =
            "❌ حالة الكود: غير صالح\n" +
            `• الكود: ${d.uc_code || ucCode}\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: d.uc_code || ucCode,
            result: "failed"
          });
        }
      }
    } catch (err) {
      console.error("خطأ checkCode:", err.message);
      await bot.sendMessage(
        chatId,
        "❌ حدث خطأ أثناء فحص الكود. جرّب لاحقًا."
      );

      await logOperation(userId, {
        type: "check",
        code: ucCode,
        result: "error"
      });
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }

    return;
  }

  // تفعيل: الخطوة 1 — ID
  if (session.mode === "WAIT_ACTIVATE_PLAYER_ID") {
    if (!isDigits(text)) {
      return bot.sendMessage(
        chatId,
        "⚠️ ID غير صالح.\nأرسل أرقام فقط بدون مسافات."
      );
    }

    const playerId = text;
    session.temp = { playerId };
    session.mode = "WAIT_ACTIVATE_CODE";

    try {
      await bot.sendMessage(chatId, "⏳ يتم الاستعلام عن اللاعب ...");

      const data = await getPlayerInfo(playerId);
      if (data.success && data.data && data.data.status === "success") {
        const p = data.data;
        session.temp.playerName = p.player_name;

        const reply =
          "👤 بيانات اللاعب:\n" +
          `• ID: ${p.player_id}\n` +
          `• الاسم: ${p.player_name}\n\n` +
          "أرسل الآن كود UC الذي تريد تفعيله لهذا اللاعب.";
        await bot.sendMessage(chatId, reply);
      } else {
        await bot.sendMessage(
          chatId,
          "⚠️ لم يتم العثور على اللاعب، لكن يمكنك إرسال الكود وسنحاول التفعيل على هذا الـ ID."
        );
        await bot.sendMessage(
          chatId,
          "أرسل الآن كود UC الذي تريد تفعيله لهذا اللاعب."
        );
      }
    } catch (err) {
      console.error("خطأ getPlayer داخل التفعيل:", err.message);
      await bot.sendMessage(
        chatId,
        "⚠️ تعذر استعلام اسم اللاعب، لكن يمكنك الاستمرار.\nأرسل الآن كود UC للتفعيل."
      );
    }

    return;
  }

  // تفعيل: الخطوة 2 — الكود
  if (session.mode === "WAIT_ACTIVATE_CODE" && session.temp?.playerId) {
    const ucCode = text;
    const playerId = session.temp.playerId;
    const playerName = session.temp.playerName || "-";

    try {
      await bot.sendMessage(chatId, "⏳ يتم تفعيل الكود ...");

      // أولاً نفحص الكود
      const checkData = await checkUcCode(ucCode);

      if (!checkData.success || !checkData.data) {
        await bot.sendMessage(
          chatId,
          "❌ تعذر فحص الكود قبل التفعيل. جرّب لاحقًا."
        );

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: ucCode,
          result: "check_error"
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      const cd = checkData.data;
      const cStatus = cd.status || "unknown";
      const activatedTo = cd.activated_to || "-";
      const activatedAtStr = cd.activated_at
        ? formatDateTimeFromUnix(cd.activated_at)
        : "-";

      if (cStatus === "activated") {
        const reply =
          "⚠️ الكود مفعل مسبقًا\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${cd.uc_code || ucCode}\n` +
          `• تم التفعيل على ID: ${activatedTo}\n` +
          `• وقت التفعيل: ${activatedAtStr}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: cd.uc_code || ucCode,
          result: "already_activated"
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      if (cStatus !== "unactivated") {
        const reply =
          "❌ لا يمكن تفعيل هذا الكود (حالة غير صالحة).\n" +
          `• الكود: ${cd.uc_code || ucCode}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: cd.uc_code || ucCode,
          result: "invalid_before_activate"
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      // الكود غير مفعّل — نحاول التفعيل
      const actData = await activateUcCode(playerId, ucCode);

      if (actData && actData.success) {
        const reply =
          "✅ تم تفعيل الكود بنجاح\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${ucCode}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: ucCode,
          result: "success"
        });
      } else {
        const reply =
          "❌ فشل تفعيل الكود\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${ucCode}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: ucCode,
          result: "failed"
        });
      }
    } catch (err) {
      console.error("خطأ أثناء تفعيل الكود:", err.message);
      await bot.sendMessage(
        chatId,
        "❌ حدث خطأ أثناء تفعيل الكود. جرّب لاحقًا."
      );

      await logOperation(userId, {
        type: "activate",
        player_id: playerId,
        player_name: playerName,
        code: ucCode,
        result: "error"
      });
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }

    return;
  }

  // لو ما في وضع معيّن نرجّعه للقائمة
  if (!session.mode) {
    await sendMainMenu(chatId);
  }
});

// ============ عرض السجل مع الأزرار (callback_query) ============

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  if (!isTrader(userId)) {
    return bot.answerCallbackQuery(query.id, {
      text: "هذه الميزة للتجّار فقط.",
      show_alert: true
    });
  }

  if (!data.startsWith("logs:")) {
    return bot.answerCallbackQuery(query.id);
  }

  const parts = data.split(":"); // logs:type:page
  const logType = parts[1] || null; // check / activate / player
  const page = Number(parts[2] || "1") || 1;

  const { items, page: currentPage, totalPages } = await getTraderLogs(userId, {
    type: logType,
    page,
    pageSize: 10
  });

  let title = "";
  if (logType === "check") title = "🧪 سجل فحص الأكواد";
  else if (logType === "activate") title = "⚡ سجل تفعيل الأكواد";
  else if (logType === "player") title = "🎮 سجل استعلام اللاعبين";
  else title = "📒 السجل";

  if (!items.length) {
    await bot.answerCallbackQuery(query.id, {
      text: "لا توجد سجلات من هذا النوع حالياً.",
      show_alert: true
    });
    return;
  }

  let txt = `${title} — صفحة ${currentPage} من ${totalPages}\n\n`;

  for (const op of items) {
    const when = formatDateTimeFromUnix(op.time);
    if (op.type === "check") {
      txt += `• كود: ${op.code || "-"} — (${op.result || "-"})\n`;
      txt += `  في: ${when}\n\n`;
    } else if (op.type === "activate") {
      txt += `• كود: ${op.code || "-"} — (${op.result || "-"})\n`;
      txt += `  لاعب: ${op.player_name || "-"} (${op.player_id || "-"})\n`;
      txt += `  في: ${when}\n\n`;
    } else if (op.type === "player") {
      txt += `• لاعب: ${op.player_name || "-"} (${op.player_id || "-"})\n`;
      txt += `  في: ${when}\n\n`;
    } else {
      txt += `• نوع: ${op.type || "-"} — في: ${when}\n\n`;
    }
  }

  const buttons = [];
  if (currentPage > 1) {
    buttons.push({
      text: "« السابق",
      callback_data: `logs:${logType}:${currentPage - 1}`
    });
  }
  if (currentPage < totalPages) {
    buttons.push({
      text: "التالي »",
      callback_data: `logs:${logType}:${currentPage + 1}`
    });
  }

  const keyboard =
    buttons.length > 0
      ? {
          reply_markup: {
            inline_keyboard: [buttons]
          }
        }
      : {};

  await bot.editMessageText(txt, {
    chat_id: chatId,
    message_id: query.message.message_id,
    ...keyboard,
    disable_web_page_preview: true
  });

  await bot.answerCallbackQuery(query.id);
});

// ===================== Inline Mode — استعلام لاعب + فحص كود UC =====================

bot.on("inline_query", async (query) => {
  const userId = query.from.id;
  const q = (query.query || "").trim();

  console.log("🔍 inline_query from", userId, ":", q || "(empty)");

  // لو ما كتب شيء → كرت مساعدة بسيط
  if (!q) {
    return bot.answerInlineQuery(
      query.id,
      [
        {
          type: "article",
          id: "help-inline",
          title: "اكتب ID اللاعب أو كود UC",
          description: "مثال: 5398770941 أو CUsnYfE72a226eY8t1",
          input_message_content: {
            message_text:
              "استخدم وضع Inline مع هذا البوت:\n\n" +
              "• اكتب ID اللاعب لعرض الاسم.\n" +
              "• اكتب كود UC لفحص حالته.\n\n" +
              "هذا الاستعلام لا يفعّل الكود، فقط يعطيك معلومات سريعة من داخل القروب.",
          },
        },
      ],
      { cache_time: 5 }
    );
  }

  // الميزة للتجّار فقط
  if (!isTrader(userId)) {
    return bot.answerInlineQuery(
      query.id,
      [
        {
          type: "article",
          id: "no-access",
          title: "هذه الميزة مخصصة للتجّار فقط",
          description: "تحتاج اشتراك كتاجر لاستخدام الاستعلام والفحص من القروب.",
          input_message_content: {
            message_text:
              "⚠️ هذه الميزة مخصصة لتجّار شحن PUBG فقط.\n\n" +
              "لاستخدام الاستعلام السريع وفحص الأكواد من داخل القروبات، تحتاج اشتراك كتاجر.\n\n" +
              "للاشتراك أو الاستفسار:\n" +
              "• راسل مالك البوت على تيليجرام: @YOUR_USERNAME",
          },
        },
      ],
      { cache_time: 10 }
    );
  }

  // ===================== 1) استعلام سريع عن لاعب — لو النص أرقام فقط =====================
  if (/^[0-9]{5,20}$/.test(q)) {
    let result;

    try {
      const data = await getPlayerInfo(q);

      if (data.success && data.data && data.data.status === "success") {
        const p = data.data;

        const messageText =
          "👤 بيانات اللاعب (استعلام سريع من القروب):\n" +
          `• ID: ${p.player_id}\n` +
          `• الاسم: ${p.player_name}\n\n` +
          "لبدء تفعيل كود لهذا اللاعب:\n" +
          "افتح محادثة البوت الخاصة واضغط زر ⚡ تفعيل كود ثم أرسل هذا الـ ID.";

        result = {
          type: "article",
          id: `player-${p.player_id}`,
          title: `👤 ${p.player_name}`,
          description: `ID: ${p.player_id}`,
          input_message_content: {
            message_text: messageText,
          },
        };

        // تسجيل في السجل كاستعلام inline (اختياري لكن مفيد)
        logOperation(userId, {
          type: "player_inline",
          player_id: p.player_id,
          player_name: p.player_name,
          result: "success",
        }).catch(console.error);
      } else {
        const messageText =
          "⚠️ لم يتم العثور على اللاعب.\n" + `• ID: ${q}`;

        result = {
          type: "article",
          id: `player-not-found-${q}`,
          title: "⚠️ لم يتم العثور على اللاعب",
          description: `ID: ${q}`,
          input_message_content: { message_text: messageText },
        };

        logOperation(userId, {
          type: "player_inline",
          player_id: q,
          player_name: null,
          result: "not_found",
        }).catch(console.error);
      }
    } catch (err) {
      console.error("خطأ inline getPlayer:", err.message);
      result = {
        type: "article",
        id: `player-error-${q}`,
        title: "❌ خطأ أثناء استعلام اللاعب",
        description: "جرّب مرة أخرى بعد قليل.",
        input_message_content: {
          message_text:
            "❌ حدث خطأ أثناء الاستعلام عن اللاعب.\nجرّب مرة أخرى لاحقًا.",
        },
      };
    }

    return bot.answerInlineQuery(query.id, [result], { cache_time: 0 });
  }

  // ===================== 2) فحص كود UC — لو النص حروف/أرقام بطول معقول =====================
  if (/^[A-Za-z0-9]{10,32}$/.test(q)) {
    let result;

    try {
      const data = await checkUcCode(q);
      const nowStr = formatNow();

      if (data.success && data.data) {
        const d = data.data;
        const status = d.status || "unknown";
        const amount = d.amount || "-";
        const activatedTo = d.activated_to || "-";
        const activatedAtStr = d.activated_at
          ? formatDateTimeFromUnix(d.activated_at)
          : "-";

        if (status === "activated") {
          const messageText =
            "✅ الكود مُفعّل\n" +
            `• الكود: ${d.uc_code || q}\n` +
            `• الكمية: ${amount} UC\n` +
            `• تم التفعيل على ID: ${activatedTo}\n` +
            `• وقت التفعيل: ${activatedAtStr}\n` +
            `• وقت الفحص: ${nowStr}`;

          result = {
            type: "article",
            id: `code-activated-${q}`,
            title: "✅ الكود مُفعّل",
            description: `${amount} UC — مفعّل على ID ${activatedTo}`,
            input_message_content: { message_text: messageText },
          };

          logOperation(userId, {
            type: "check_inline",
            code: d.uc_code || q,
            amount,
            activated_to: activatedTo,
            activated_at: d.activated_at || null,
            result: "activated",
          }).catch(console.error);
        } else if (status === "unactivated") {
          const messageText =
            "ℹ️ الكود غير مفعّل\n" +
            `• الكود: ${d.uc_code || q}\n` +
            `• الكمية: ${amount} UC\n` +
            `• وقت الفحص: ${nowStr}`;

          result = {
            type: "article",
            id: `code-unactivated-${q}`,
            title: "ℹ️ الكود غير مفعّل",
            description: `${amount} UC — جاهز للتفعيل`,
            input_message_content: { message_text: messageText },
          };

          logOperation(userId, {
            type: "check_inline",
            code: d.uc_code || q,
            amount,
            result: "unactivated",
          }).catch(console.error);
        } else {
          const messageText =
            "❌ حالة الكود: غير صالح\n" +
            `• الكود: ${d.uc_code || q}\n` +
            `• وقت الفحص: ${nowStr}`;

          result = {
            type: "article",
            id: `code-invalid-${q}`,
            title: "❌ الكود غير صالح",
            description: "فشل التحقق من هذا الكود.",
            input_message_content: { message_text: messageText },
          };

          logOperation(userId, {
            type: "check_inline",
            code: d.uc_code || q,
            result: "failed",
          }).catch(console.error);
        }
      } else {
        result = {
          type: "article",
          id: `code-error-${q}`,
          title: "❌ تعذر فحص الكود",
          description: "جرّب مرة أخرى بعد قليل.",
          input_message_content: {
            message_text:
              "❌ تعذر فحص الكود حاليًا. جرّب مرة أخرى لاحقًا.",
          },
        };

        logOperation(userId, {
          type: "check_inline",
          code: q,
          result: "error",
        }).catch(console.error);
      }
    } catch (err) {
      console.error("خطأ inline checkCode:", err.message);
      result = {
        type: "article",
        id: `code-exception-${q}`,
        title: "❌ خطأ أثناء فحص الكود",
        description: "جرّب مرة أخرى بعد قليل.",
        input_message_content: {
          message_text:
            "❌ حدث خطأ أثناء فحص الكود. جرّب مرة أخرى لاحقًا.",
        },
      };
    }

    return bot.answerInlineQuery(query.id, [result], { cache_time: 0 });
  }

  // ===================== 3) أي شيء آخر (نص عشوائي) =====================
  return bot.answerInlineQuery(
    query.id,
    [
      {
        type: "article",
        id: "inline-help-invalid",
        title: "اكتب فقط ID أو كود UC",
        description: "مثال: 5398770941 أو CUsnYfE72a226eY8t1",
        input_message_content: {
          message_text:
            "اكتب في خانة inline فقط:\n" +
            "• ID اللاعب (أرقام فقط)\n" +
            "أو\n" +
            "• كود UC بدون مسافات.\n\n" +
            "أي نص آخر لن يتم التعامل معه.",
        },
      },
    ],
    { cache_time: 5 }
  );
});


// ===================== التعامل مع أخطاء polling =====================
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code || err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

