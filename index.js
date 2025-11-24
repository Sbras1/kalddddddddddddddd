// ==================================================
// 🤖 PUBG Trader Bot — Midasbuy + Firebase Logs
// ==================================================

require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { logOperation, getTraderLogs } = require("./firebaseLogs");

// ===================== الإعدادات من المتغيّرات =====================

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const API_KEY = (process.env.API_KEY || "").trim();
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

const API_BASE_URL = (process.env.API_BASE_URL || "https://midasbuy-api.com/api/v1/pubg").replace(
  /\/+$/,
  ""
);

// عدد أيام الاشتراك لكل تاجر جديد
const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود في المتغيّرات.");
  process.exit(1);
}
if (!API_KEY) {
  console.error("❌ API_KEY غير موجود في المتغيّرات.");
  process.exit(1);
}
if (!OWNER_ID) {
  console.warn("⚠️ OWNER_ID غير محدد – يُفضّل إضافته للتحكم بالتجّار.");
}

// ===================== إدارة التجّار =====================

const TRADERS_FILE = "traders.json";
let traders = {};

function loadTraders() {
  try {
    if (fs.existsSync(TRADERS_FILE)) {
      const raw = fs.readFileSync(TRADERS_FILE, "utf8");
      traders = raw ? JSON.parse(raw) : {};
    } else {
      traders = {};
      fs.writeFileSync(TRADERS_FILE, JSON.stringify(traders, null, 2), "utf8");
    }
  } catch (err) {
    console.error("⚠️ خطأ أثناء تحميل traders.json:", err.message);
    traders = {};
  }

  // تأكد من وجود expiresAt لكل تاجر
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  for (const [id, info] of Object.entries(traders)) {
    if (!info.addedAt) {
      info.addedAt = now;
    }
    if (!info.expiresAt) {
      info.expiresAt = info.addedAt + SUBSCRIPTION_DAYS * msPerDay;
    }
  }
  saveTraders();
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
  const info = traders[userId];
  if (!info) return false;
  if (!info.expiresAt) return true; // احتياط
  return Date.now() <= info.expiresAt;
}

function getTraderInfo(userId) {
  const info = traders[userId];
  if (!info) return null;
  const addedAt = info.addedAt || Date.now();
  const expiresAt =
    info.expiresAt || addedAt + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const isActive = now <= expiresAt;
  return {
    id: userId,
    username: info.username || null,
    name: info.name || null,
    addedAt,
    expiresAt,
    isActive
  };
}

loadTraders();

// ===================== إنشاء البوت (polling أو webhook على حسب البيئة) =====================

const WEBHOOK_URL = process.env.WEBHOOK_URL ? String(process.env.WEBHOOK_URL).replace(/\/+$/, "") : null;
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

let bot;
let botUsername = null;

if (WEBHOOK_URL) {
  // webhook mode (مناسب لـ Render وبيئات مماثلة حيث يكون هناك عنوان خارجي ثابت)
  const express = require("express");
  const bodyParser = require("body-parser");
  const app = express();
  app.use(bodyParser.json());

  bot = new TelegramBot(BOT_TOKEN, { polling: false });

  // Telegram سيُرسل التحديثات إلى هذا المسار
  app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (e) {
      console.error("Webhook processUpdate error:", e && e.message ? e.message : e);
      res.sendStatus(500);
    }
  });

  app.get("/", (req, res) => res.send("OK"));

  app.listen(PORT, async () => {
    console.log(`Express server listening on port ${PORT}`);
    try {
      await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
      console.log("✅ Webhook set to", `${WEBHOOK_URL}/bot${BOT_TOKEN}`);
    } catch (err) {
      console.error("❌ Failed to set webhook:", err && err.message ? err.message : err);
    }

    // استدعاء getMe للحصول على اسم البوت
    bot
      .getMe()
      .then((me) => {
        botUsername = me.username;
        console.log(`🤖 تم تشغيل البوت (webhook): @${botUsername}`);
        console.log(`🌐 API_BASE_URL = ${API_BASE_URL}`);
      })
      .catch((err) => {
        console.error("❌ فشل getMe:", err && err.message ? err.message : err);
      });
    });
  } else {
  // polling mode (مناسب للتشغيل المحلي)
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot
    .getMe()
    .then((me) => {
      botUsername = me.username;
      console.log(`🤖 تم تشغيل البوت: @${botUsername}`);
      console.log(`🌐 API_BASE_URL = ${API_BASE_URL}`);
    })
    .catch((err) => {
      console.error("❌ فشل getMe:", err && err.message ? err.message : err);
    });
  }

// ===================== إدارة الجلسات =====================

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

// ===================== دوال مساعدة =====================

function isDigits(text) {
  return /^[0-9]+$/.test((text || "").trim());
}

function formatDateTimeFromUnix(unixOrMs) {
  if (!unixOrMs && unixOrMs !== 0) return "-";

  let ms = Number(unixOrMs);
  if (ms < 1e12) {
    ms = ms * 1000;
  }

  const d = new Date(ms);
  return d.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour12: true
  });
}

function formatNow() {
  const d = new Date();
  return d.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour12: true
  });
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

// ===================== استدعاءات Midasbuy =====================

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

// ===================== لوحة المفاتيح الرئيسية =====================

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["🎮 استعلام عن لاعب", "🧪 فحص كود"],
        ["⚡ تفعيل كود", "📒 سجلي"],
        ["👤 حسابي", "💳 الاشتراك"]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

async function sendMainMenu(chatId) {
  await bot.sendMessage(chatId, "اختر العملية المطلوبة من القائمة:", mainMenuKeyboard());
}

// ===================== دوال عرض السجل =====================

async function sendLogsSummary(chatId, userId) {
  try {
    const { items, total } = await getTraderLogs(userId, {
      page: 1,
      pageSize: 200
    });

    if (!total || !items || !items.length) {
      await bot.sendMessage(chatId, "لا يوجد سجلات حتى الآن لهذا الحساب.");
      return;
    }

    let countActivate = 0;
    let countCheck = 0;
    let countPlayer = 0;

    for (const op of items) {
      if (!op || !op.type) continue;
      if (op.type === "activate") countActivate++;
      else if (op.type === "check") countCheck++;
      else if (op.type === "player") countPlayer++;
    }

    const text =
      "📒 ملخص سجلك:\n\n" +
      `• عدد عمليات التفعيل: ${countActivate}\n` +
      `• عدد عمليات فحص الأكواد: ${countCheck}\n` +
      `• عدد عمليات استعلام اللاعبين: ${countPlayer}\n` +
      `• إجمالي العمليات المسجلة: ${total}\n\n` +
      "اختر ما تريد استعراضه بالتفصيل:";

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔌 استعرض التفعيل", callback_data: "logs:activate:1" }],
          [{ text: "🧪 استعرض الفحص", callback_data: "logs:check:1" }],
          [{ text: "🎮 استعرض الاستعلام", callback_data: "logs:player:1" }]
        ]
      }
    };

    await bot.sendMessage(chatId, text, keyboard);
  } catch (err) {
    console.error("خطأ sendLogsSummary:", err.message);
    await bot.sendMessage(
      chatId,
      "❌ حدث خطأ أثناء جلب ملخص السجل. جرّب لاحقًا."
    );
  }
}

function buildSubscriptionText() {
  return (
    "💳 تفاصيل الاشتراك في بوت التاجر:\n\n" +
    "• 49 ريال / شهر — تاجر واحد\n" +
    "  يشمل:\n" +
    "  – استعلام اللاعبين بالـ ID\n" +
    "  – فحص أكواد UC\n" +
    "  – تفعيل الأكواد على حسابات العملاء\n" +
    "  – عرض سجل عملياتك من داخل البوت\n\n" +
    "للاشتراك أو الاستفسار:\n" +
    "• راسل مالك البوت على تيليجرام: @YOUR_USERNAME"
  );
}

async function sendAccountInfo(chatId, userId) {
  const info = getTraderInfo(userId);
  if (!info) {
    await bot.sendMessage(
      chatId,
      "أنت غير مسجّل كتاجر في هذا البوت.\n\n" + buildSubscriptionText()
    );
    return;
  }

  const addedStr = formatDateTimeFromUnix(info.addedAt);
  const expStr = formatDateTimeFromUnix(info.expiresAt);
  const now = Date.now();
  const diffMs = info.expiresAt - now;
  const daysLeft = Math.max(Math.floor(diffMs / (24 * 60 * 60 * 1000)), 0);

  const statusText = info.isActive ? "✅ مشترك" : "❌ غير مشترك (انتهى الاشتراك)";

  let txt =
    "👤 حساب التاجر:\n\n" +
    `• ID: ${info.id}\n`;
  if (info.username) txt += `• يوزر: ${info.username}\n`;
  if (info.name) txt += `• الاسم: ${info.name}\n`;
  txt += `\n• حالة الاشتراك: ${statusText}\n`;
  txt += `• تاريخ التسجيل: ${addedStr}\n`;
  txt += `• تاريخ الانتهاء: ${expStr}\n`;
  if (info.isActive) {
    txt += `• الأيام المتبقية تقريبًا: ${daysLeft} يوم\n`;
  }

  await bot.sendMessage(chatId, txt);
}

// ===================== أوامر إدارة التجّار (للمالك) =====================

bot.onText(/^\/اضف_تاجر(?:\s+(.+))?$/i, async (msg, match) => {
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

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
    targetName = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
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
      "⚠️ استخدم الأمر هكذا:\n" +
        "• بالرد على رسالة التاجر: `/اضف_تاجر`\n" +
        "أو\n" +
        "• مع ID مباشر: `/اضف_تاجر 123456789`",
      { parse_mode: "Markdown" }
    );
  }

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const expiresAt = now + SUBSCRIPTION_DAYS * msPerDay;

  traders[targetId] = {
    username: targetUsername,
    name: targetName,
    addedBy: fromId,
    addedAt: now,
    expiresAt
  };
  saveTraders();

  let txt =
    "✅ تم إضافة التاجر بنجاح.\n" +
    `• ID: ${targetId}\n`;
  if (targetUsername) txt += `• يوزر: ${targetUsername}\n`;
  if (targetName) txt += `• الاسم: ${targetName}\n`;
  txt += `• الانتهاء بعد: ${SUBSCRIPTION_DAYS} يوم\n`;

  await bot.sendMessage(chatId, txt);
});

bot.onText(/^\/حذف_تاجر(?:\s+(.+))?$/i, async (msg, match) => {
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  let targetId = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    targetId = msg.reply_to_message.from.id;
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
      "⚠️ استخدم الأمر هكذا:\n" +
        "• بالرد على رسالة التاجر: `/حذف_تاجر`\n" +
        "أو\n" +
        "• مع ID مباشر: `/حذف_تاجر 123456789`",
      { parse_mode: "Markdown" }
    );
  }

  if (!traders[targetId]) {
    return bot.sendMessage(chatId, "ℹ️ هذا ID غير موجود في قائمة التجّار.");
  }

  delete traders[targetId];
  saveTraders();

  await bot.sendMessage(
    chatId,
    `✅ تم حذف التاجر من القائمة.\n• ID: ${targetId}`
  );
});

bot.onText(/^\/قائمة_التجار$/i, async (msg) => {
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  const entries = Object.entries(traders);
  if (!entries.length) {
    return bot.sendMessage(chatId, "لا يوجد تجّار مسجّلين حاليًا.");
  }

  let text = `📋 قائمة التجّار (${entries.length}):\n\n`;
  const now = Date.now();

  for (const [id, info] of entries) {
    const username = info.username || "";
    const name = info.name || "";
    const expiresAt = info.expiresAt || 0;
    const active = !expiresAt || now <= expiresAt;
    const status = active ? "✅ نشط" : "❌ منتهي";

    text += `• ID: ${id}`;
    if (username) text += ` — ${username}`;
    if (name) text += ` — ${name}`;
    text += ` — ${status}\n`;
  }

  await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
});

// ===================== أوامر /start /سجلي /الاشتراك /حسابي =====================

bot.onText(/^\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  resetSession(chatId);

  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "يمكنك مشاهدة الأزرار، لكن استخدام المزايا يحتاج اشتراك كتاجر.\n\n" +
      buildSubscriptionText();
    await bot.sendMessage(chatId, txt, mainMenuKeyboard());
    return;
  }

  let welcome = "أهلاً بك في بوت تاجر PUBG 💳\n\n";
  welcome += "يمكنك عبر هذا البوت:\n";
  welcome += "• استعلام عن اسم اللاعب عن طريق الـ ID.\n";
  welcome += "• فحص أكواد UC ومعرفة حالتها.\n";
  welcome += "• تفعيل أكواد UC على حسابات العملاء.\n";
  welcome += "• متابعة سجل عملياتك.\n\n";
  welcome += "اختر العملية من الأزرار بالأسفل.";

  await bot.sendMessage(chatId, welcome, mainMenuKeyboard());
});

bot.onText(/^\/سجلي$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "لا يمكنك استخدام هذه الميزة قبل الاشتراك كتاجر.\n\n" +
      buildSubscriptionText();
    return bot.sendMessage(chatId, txt);
  }

  await sendLogsSummary(chatId, userId);
});

bot.onText(/^\/الاشتراك$/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, buildSubscriptionText(), {
    disable_web_page_preview: true
  });
});

bot.onText(/^\/حسابي$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await sendAccountInfo(chatId, userId);
});

// ===================== التعامل مع الرسائل (الأزرار النصية) =====================

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  // تجاهل الأوامر اللي لها onText خاص
  if (
    /^\/start/i.test(text) ||
    /^\/سجلي$/i.test(text) ||
    /^\/الاشتراك$/i.test(text) ||
    /^\/اضف_تاجر/i.test(text) ||
    /^\/حذف_تاجر/i.test(text) ||
    /^\/قائمة_التجار$/i.test(text) ||
    /^\/حسابي$/i.test(text)
  ) {
    return;
  }

  const session = getSession(chatId);

  // زر الاشتراك — متاح للجميع
  if (text === "💳 الاشتراك") {
    await bot.sendMessage(chatId, buildSubscriptionText(), {
      disable_web_page_preview: true
    });
    return;
  }

  // زر حسابي
  if (text === "👤 حسابي") {
    await sendAccountInfo(chatId, userId);
    return;
  }

  // باقي المزايا للتجّار فقط
  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "لا يمكنك استخدام هذه الميزة قبل الاشتراك كتاجر.\n\n" +
      buildSubscriptionText();
    await bot.sendMessage(chatId, txt);
    return;
  }

  // القائمة الرئيسية
  if (text === "🎮 استعلام عن لاعب") {
    session.mode = "WAIT_PLAYER_LOOKUP_ID";
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب (أرقام فقط) لعرض الاسم."
    );
    return;
  }

  if (text === "🧪 فحص كود") {
    session.mode = "WAIT_CHECK_CODE";
    await bot.sendMessage(
      chatId,
      "أرسل الآن كود UC المراد فحصه (انسخه كامل بدون مسافات زائدة)."
    );
    return;
  }

  if (text === "⚡ تفعيل كود") {
    session.mode = "WAIT_ACTIVATE_PLAYER_ID";
    session.temp = {};
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب الذي تريد تفعيل الكود له (أرقام فقط)."
    );
    return;
  }

  if (text === "📒 سجلي") {
    await sendLogsSummary(chatId, userId);
    return;
  }

  // --------- وضع: استعلام عن لاعب ----------
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

      await logOperation(userId, {
        type: "player",
        player_id: playerId,
        player_name: null,
        result: "error"
      });
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }
    return;
  }

  // --------- وضع: فحص كود ----------
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
        const status = (d.status || "").toLowerCase();
        const amount = d.amount || "-";
        const activatedTo = d.activated_to || "-";
        const activatedAtStr = d.activated_at
          ? formatDateTimeFromUnix(d.activated_at)
          : "-";
        const codeValue = d.uc_code || ucCode;

        if (status === "activated") {
          const reply =
            "✅ الكود مُفعّل\n" +
            `• الكود: ${codeValue}\n` +
            `• الكمية: ${amount} UC\n` +
            `• تم التفعيل على ID: ${activatedTo}\n` +
            `• وقت التفعيل: ${activatedAtStr}\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: codeValue,
            amount,
            activated_to: activatedTo,
            activated_at: d.activated_at || null,
            result: "activated"
          });
        } else if (status === "unactivated") {
          const reply =
            "ℹ️ الكود غير مفعّل\n" +
            `• الكود: ${codeValue}\n` +
            `• الكمية: ${amount} UC\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: codeValue,
            amount,
            result: "unactivated"
          });
        } else {
          const reply =
            "❌ حالة الكود: غير صالح\n" +
            `• الكود: ${codeValue}\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: codeValue,
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

  // --------- وضع: تفعيل كود (الخطوة الأولى: ID) ----------
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

  // --------- وضع: تفعيل كود (الخطوة الثانية: الكود) ----------
  if (session.mode === "WAIT_ACTIVATE_CODE" && session.temp?.playerId) {
    const ucCode = text;
    const playerId = session.temp.playerId;
    const playerName = session.temp.playerName || "-";

    try {
      await bot.sendMessage(chatId, "⏳ يتم التحقق من حالة الكود قبل التفعيل ...");

      // أولاً: فحص الكود قبل التفعيل
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
      const status = (cd.status || "").toLowerCase();
      const activatedTo = cd.activated_to || "-";
      const activatedAtStr = cd.activated_at
        ? formatDateTimeFromUnix(cd.activated_at)
        : "-";
      const codeValue = cd.uc_code || ucCode;

      if (status === "activated") {
        // مفعل مسبقًا — لا نحاول التفعيل مرة أخرى
        const reply =
          "⚠️ الكود مفعل مسبقًا\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${codeValue}\n` +
          `• تم التفعيل على ID: ${activatedTo}\n` +
          `• وقت التفعيل: ${activatedAtStr}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: codeValue,
          result: "already_activated"
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      if (status !== "unactivated") {
        // حالة غير صالحة — لا نحاول التفعيل
        const reply =
          "❌ لا يمكن تفعيل هذا الكود\n" +
          `• الكود: ${codeValue}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: codeValue,
          result: "invalid_before_activate"
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      // هنا الكود غير مفعّل — نحاول التفعيل فعليًا
      await bot.sendMessage(chatId, "⏳ يتم تفعيل الكود ...");
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
      console.error("خطأ أثناء تفعيل الكود (check + activate):", err.message);
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

  // لو ما في وضع معيّن، نرجّعه للقائمة
  if (!session.mode) {
    await sendMainMenu(chatId);
  }
});

// ===================== Inline Mode: استعلام سريع + فحص كود =====================

bot.on("inline_query", async (query) => {
  try {
    const inlineId = query.id;
    const userId = query.from.id;
    const q = (query.query || "").trim();

    console.log("🔍 inline_query from", userId, ":", q || "(empty)");

    // لا نسمح إلا للتجّار باستخدام inline
    if (!isTrader(userId)) {
      return bot.answerInlineQuery(inlineId, [], { cache_time: 5 });
    }

    if (!q) {
      // لا يوجد نص، لا نرجع شيء
      return bot.answerInlineQuery(inlineId, [], { cache_time: 5 });
    }

    const results = [];

    // لو أرقام فقط => استعلام لاعب
    if (isDigits(q)) {
      const playerId = q;

      try {
        const data = await getPlayerInfo(playerId);
        if (data.success && data.data && data.data.status === "success") {
          const p = data.data;

          const title = `👤 ${p.player_name}`;
          const desc = `ID: ${p.player_id}`;
          const text =
            "👤 بيانات اللاعب:\n" +
            `• ID: ${p.player_id}\n` +
            `• الاسم: ${p.player_name}\n\n` +
            "يمكنك استخدام زر ⚡ تفعيل كود من البوت لتفعيل كود لهذا اللاعب.";

          results.push({
            type: "article",
            id: `player-${p.player_id}`,
            title,
            description: desc,
            input_message_content: {
              message_text: text
            }
          });

          await logOperation(userId, {
            type: "player",
            player_id: p.player_id,
            player_name: p.player_name,
            result: "success_inline"
          });
        }
      } catch (err) {
        console.error("خطأ inline getPlayer:", err.message);
      }
    } else if (/^[A-Za-z0-9]{8,}$/.test(q)) {
      // احتمال أنه UC code
      const ucCode = q;

      try {
        const data = await checkUcCode(ucCode);
        if (data.success && data.data) {
          const d = data.data;
          const status = (d.status || "").toLowerCase();
          const amount = d.amount || "-";
          const codeValue = d.uc_code || ucCode;
          let statusText = "";
          let icon = "";

          if (status === "activated") {
            icon = "✅";
            statusText = "الكود مُفعّل";
          } else if (status === "unactivated") {
            icon = "ℹ️";
            statusText = "الكود غير مفعّل";
          } else {
            icon = "❌";
            statusText = "الكود غير صالح";
          }

          const title = `${icon} ${statusText}`;
          const desc = `الكود: ${codeValue} — الكمية: ${amount} UC`;
          const text =
            `${icon} ${statusText}\n` +
            `• الكود: ${codeValue}\n` +
            `• الكمية: ${amount} UC`;

          results.push({
            type: "article",
            id: `code-${codeValue}`,
            title,
            description: desc,
            input_message_content: {
              message_text: text
            }
          });

          await logOperation(userId, {
            type: "check",
            code: codeValue,
            amount,
            result: status || "unknown_inline"
          });
        }
      } catch (err) {
        console.error("خطأ inline checkCode:", err.message);
      }
    }

    await bot.answerInlineQuery(inlineId, results, { cache_time: 3 });
  } catch (err) {
    console.error("خطأ عام في inline_query:", err.message);
  }
});

// ===================== استعراض السجلات بالتفصيل (Callback) =====================

bot.on("callback_query", async (query) => {
  try {
    const data = query.data || "";
    const chatId = query.message?.chat?.id;
    const userId = query.from?.id;

    if (!chatId || !userId) return;

    if (data.startsWith("logs:")) {
      const parts = data.split(":"); // [ "logs", "activate", "1" ]
      const logType = parts[1]; // "activate" | "check" | "player"
      const page = Number(parts[2] || "1") || 1;

      const pageSize = 10;
      const { items } = await getTraderLogs(userId, {
        page,
        pageSize
      });

      if (!items || !items.length) {
        await bot.answerCallbackQuery(query.id, {
          text: "لا يوجد سجلات في هذه الصفحة.",
          show_alert: true
        });
        return;
      }

      const filtered = items.filter((op) => op && op.type === logType);
      if (!filtered.length) {
        await bot.answerCallbackQuery(query.id, {
          text: "لا يوجد سجلات من هذا النوع في هذه الصفحة.",
          show_alert: true
        });
        return;
      }

      let title = "";
      if (logType === "activate") title = "🔌 سجل التفعيل";
      else if (logType === "check") title = "🧪 سجل فحص الأكواد";
      else if (logType === "player") title = "🎮 سجل استعلام اللاعبين";
      else title = "📒 السجل";

      let text = `${title} (صفحة ${page}):\n\n`;

      for (const op of filtered) {
        const when = formatDateTimeFromUnix(op.time);
        if (logType === "activate") {
          text +=
            `• كود: ${op.code || "-"}\n` +
            `  لاعب: ${op.player_name || "-"} (${op.player_id || "-"})\n` +
            `  نتيجة: ${op.result || "-"}\n` +
            `  في: ${when}\n\n`;
        } else if (logType === "check") {
          text +=
            `• كود: ${op.code || "-"}\n` +
            `  نتيجة: ${op.result || "-"}\n` +
            `  في: ${when}\n\n`;
        } else if (logType === "player") {
          text +=
            `• لاعب: ${op.player_name || "-"} (${op.player_id || "-"})\n` +
            `  نتيجة: ${op.result || "-"}\n` +
            `  في: ${when}\n\n`;
        }
      }

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        disable_web_page_preview: true
      });

      await bot.answerCallbackQuery(query.id);
    }
  } catch (err) {
    console.error("خطأ في callback_query:", err.message);
    try {
      await bot.answerCallbackQuery(query.id, {
        text: "حدث خطأ أثناء معالجة الطلب.",
        show_alert: true
      });
    } catch (e) {}
  }
});

// ===================== التعامل مع أخطاء polling =====================

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code || err.message);
  if (err.response && err.response.body) {
    console.error("Polling error body:", err.response.body);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
