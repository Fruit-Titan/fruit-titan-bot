const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "9185746835:AAFSJXdgMJI_SH-klpoTpowKMzDQocSOqVo";
const ADMIN_IDS = (process.env.ADMIN_IDS || "1932161126")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const REQUIRED_CHANNEL = "@ROL_TOKN";
const REQUIRED_CHANNEL_URL = "https://t.me/ROL_TOKN";
const ROL_JETTON_MASTER = "EQApOJVuhW8SIGHYAEdYOGvefbBf8r6IiApqyoffbbjXOIFc";
const VERIFY_DEST_WALLET = "UQCYWzbDk673PWtuz_hwDq9WhGdS9Nz_Ppe-DLIFdNb5BsAb";
const MINI_APP_URL = process.env.MINI_APP_URL || "https://fruit-titan.github.io/fruit-titan-app/";
const DATA_FILE = process.env.DATA_FILE_PATH || path.join(__dirname, "rol_bot_data.json");

const CONTEST_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const REFERRAL_BONUS_ROL = 60;
const REFERRAL_BONUS_SPINS = 1;
const MIN_WITHDRAW_ROL = 10000;
const CUSTOM_TASK_REWARD_ROL = 10;
const MIN_CUSTOM_TASK_USERS = 50;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const adminStates = new Map();
const avatarCache = new Map();

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createDefaultStore() {
  const now = Date.now();
  return {
    users: {},
    tasks: [],
    withdrawals: [],
    system: {
      maintenanceEnabled: false,
      maintenanceMessage: "نقوم حالياً بتحديث النظام وتحسين الأداء. سنعود للعمل قريباً.",
      allowedTesters: []
    },
    contest: {
      startedAt: now,
      endsAt: now + CONTEST_DURATION_MS
    }
  };
}

function loadStore() {
  const fallback = createDefaultStore();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const merged = {
          users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          withdrawals: Array.isArray(parsed.withdrawals) ? parsed.withdrawals : [],
          system: {
            maintenanceEnabled: Boolean(parsed.system?.maintenanceEnabled),
            maintenanceMessage:
              parsed.system?.maintenanceMessage ||
              "نقوم حالياً بتحديث النظام وتحسين الأداء. سنعود للعمل قريباً.",
            allowedTesters: Array.isArray(parsed.system?.allowedTesters)
              ? parsed.system.allowedTesters.map(String)
              : []
          },
          contest: {
            startedAt: Number(parsed.contest?.startedAt) > 0 ? Number(parsed.contest.startedAt) : Date.now(),
            endsAt:
              Number(parsed.contest?.endsAt) > 0
                ? Number(parsed.contest.endsAt)
                : (Number(parsed.contest?.startedAt) || Date.now()) + CONTEST_DURATION_MS
          }
        };
        return merged;
      }
    }
  } catch (err) {
    console.error("Failed to load store:", err.message);
  }
  return fallback;
}

let store = loadStore();

function saveStore() {
  try {
    ensureParentDir(DATA_FILE);
    const tempPath = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tempPath, DATA_FILE);
  } catch (err) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
    } catch (e2) {
      console.error("Failed to save store:", e2.message);
    }
  }
}

saveStore();

function normalizeContestWindow() {
  store.contest = store.contest || {};
  const now = Date.now();
  let startedAt = Number(store.contest.startedAt) || now;
  let endsAt = Number(store.contest.endsAt) || startedAt + CONTEST_DURATION_MS;

  while (endsAt <= now) {
    startedAt = endsAt;
    endsAt = startedAt + CONTEST_DURATION_MS;
  }

  store.contest.startedAt = startedAt;
  store.contest.endsAt = endsAt;
  return store.contest;
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function ensureUserRecord(uid, extra = {}) {
  const key = String(uid);
  store.users = store.users || {};
  if (!store.users[key]) {
    store.users[key] = {
      uid: key,
      username: extra.username || "",
      firstName: extra.firstName || `Miner ${key}`,
      balance: 0,
      vip: 1,
      dailyProfit24h: 400,
      onChainWalletROL: 0,
      wallet: "",
      isVerified: false,
      verifyProof: "",
      firstFreeUsed: false,
      spinTickets: 0,
      startTime: 0,
      checkinDay: 0,
      lastCheckinTime: 0,
      completedTasks: [],
      refCount: 0,
      refEarn: 0,
      referralsList: [],
      referredBy: extra.referredBy || "",
      banned: false,
      history: [],
      updatedAt: Date.now()
    };
  }
  const u = store.users[key];
  u.uid = key;
  if (extra.username) u.username = extra.username;
  if (extra.firstName) u.firstName = extra.firstName;
  if (extra.referredBy && !u.referredBy) u.referredBy = String(extra.referredBy);
  u.referralsList = Array.isArray(u.referralsList) ? u.referralsList : [];
  u.history = Array.isArray(u.history) ? u.history : [];
  u.completedTasks = Array.isArray(u.completedTasks) ? u.completedTasks : [];
  return u;
}

function getVerifiedCountForUser(user) {
  if (!user) return 0;
  const listVerified = Array.isArray(user.referralsList)
    ? user.referralsList.filter((r) => Boolean(r && r.verified)).length
    : 0;
  return Math.max(Number(user.refCount || 0), listVerified);
}

function getTop20List() {
  const usersArr = Object.values(store.users || {}).filter((u) => u && !u.banned);
  return usersArr
    .map((u) => ({
      uid: String(u.uid),
      firstName: u.firstName || `Miner ${u.uid}`,
      username: u.username || "",
      verifiedReferrals: getVerifiedCountForUser(u),
      photoUrl: u.photoUrl || ""
    }))
    .filter((item) => item.verifiedReferrals > 0)
    .sort((a, b) => b.verifiedReferrals - a.verifiedReferrals)
    .slice(0, 20);
}

function getAdminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🏆 حاملي العملة Top 100", callback_data: "admin_top100" },
        { text: "📩 مراجعة السحوبات", callback_data: "admin_withdrawals" }
      ],
      [
        { text: "👥 إحصائيات المستخدمين", callback_data: "admin_stats" },
        { text: "🗂️ سجل مستخدم (History)", callback_data: "admin_history" }
      ],
      [
        { text: "🚫 حظر مستخدم", callback_data: "admin_ban" },
        { text: "📋 المهام (الحالية والسابقة)", callback_data: "admin_tasks" }
      ],
      [
        { text: "🧪 إضافة مختبر", callback_data: "admin_add_tester" },
        { text: "✅ إلغاء حظر", callback_data: "admin_unban" }
      ],
      [
        { text: "💾 نسخة احتياطية للبيانات", callback_data: "admin_backup" },
        {
          text: store.system?.maintenanceEnabled
            ? "🟢 إيقاف صيانة التطبيق"
            : "🔴 تفعيل صيانة التطبيق",
          callback_data: "admin_toggle_maint"
        }
      ],
      [
        { text: "➕ إضافة إحالات موثقة", callback_data: "admin_add_refs" },
        { text: "🔄 تحديث الإحصائيات", callback_data: "admin_stats" }
      ],
      [
        { text: "⚠️ تصفير جميع الأرصدة (Reset)", callback_data: "admin_reset_confirm" }
      ]
    ]
  };
}

function formatAdminPanelMessage() {
  const users = Object.values(store.users || {});
  const totalUsers = users.length;
  const holdersCount = users.filter((u) => Number(u.balance || 0) > 0).length;
  const bannedCount = users.filter((u) => Boolean(u.banned)).length;
  const verifiedCount = users.filter((u) => Boolean(u.isVerified)).length;
  const walletsCount = users.filter((u) => Boolean(u.wallet)).length;
  const totalRolInside = users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
  const pendingWithdrawals = (store.withdrawals || []).filter((w) => w.status === "pending").length;
  const maintStatus = store.system?.maintenanceEnabled ? "مفعل 🔴" : "متوقف 🟢";
  const testersCount = Array.isArray(store.system?.allowedTesters) ? store.system.allowedTesters.length : 0;

  return (
    `👑 <b>لوحة تحكم المشرف العليا (ROL Admin)</b>\n\n` +
    `• إجمالي المستخدمين الحقيقيين: <b>${totalUsers}</b>\n` +
    `• حاملو العملة داخل البوت (&gt;0 ROL): <b>${holdersCount}</b>\n` +
    `• الحسابات الموثقة (0.05 GRAM): <b>${verifiedCount}</b>\n` +
    `• المحافظ المربوطة: <b>${walletsCount}</b>\n` +
    `• عدد المحظورين: <b>${bannedCount}</b>\n` +
    `• طلبات السحب المعلقة: <b>${pendingWithdrawals}</b>\n` +
    `• صيانة التطبيق: <b>${maintStatus}</b>\n` +
    `• المختبرون المسموح لهم: <b>${testersCount}</b>\n` +
    `• إجمالي أرصدة ROL داخل البوت: <b>${Number(totalRolInside.toFixed(2))} ROL</b>\n\n` +
    `اختر الإجراء المطلوب:`
  );
}

async function sendBackupFile(chatId) {
  saveStore();
  try {
    await bot.sendDocument(
      chatId,
      DATA_FILE,
      {
        caption: "🗂️ نسخة احتياطية لبيانات البوت والمستخدمين والمهام"
      },
      {
        filename: "rol_bot_data.json",
        contentType: "application/json"
      }
    );
  } catch (err) {
    await bot.sendMessage(chatId, `⚠️ تعذر إرسال الملف: ${err.message}`);
  }
}

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const param = (match && match[1] ? match[1] : "").trim();
  const refFromStart = param.startsWith("ref_") ? param.replace("ref_", "").trim() : "";

  const user = ensureUserRecord(fromId, {
    username: msg.from.username || "",
    firstName: msg.from.first_name || "Miner",
    referredBy: refFromStart && refFromStart !== fromId ? refFromStart : ""
  });

  if (refFromStart && refFromStart !== fromId && store.users[refFromStart]) {
    const referrer = ensureUserRecord(refFromStart);
    const exists = referrer.referralsList.some((r) => String(r.uid) === fromId);
    if (!exists) {
      referrer.referralsList.push({
        uid: fromId,
        firstName: msg.from.first_name || `Miner ${fromId}`,
        username: msg.from.username || "",
        verified: false,
        joinedAt: Date.now()
      });
      saveStore();
    }
  } else {
    saveStore();
  }

  const keyboardRows = [
    [
      {
        text: "🚀 Start ROL Mining Now",
        web_app: { url: MINI_APP_URL }
      }
    ],
    [
      {
        text: "📢 Official Channel (@ROL_TOKN)",
        url: REQUIRED_CHANNEL_URL
      }
    ]
  ];

  if (isAdmin(fromId)) {
    keyboardRows.push([
      {
        text: "👑 لوحة تحكم المشرف (Admin)",
        callback_data: "admin_panel_open"
      }
    ]);
  }

  await bot.sendMessage(
    chatId,
    `💎 <b>Welcome to ROL Mining (@ROL_Mining_bot)</b>\n\n` +
      `Mine <b>ROL</b> on the <b>TON</b> blockchain, complete tasks, spin the wheel, invite friends, and compete on the <b>TOP 20</b> leaderboard.\n\n` +
      `📜 Contract: <code>${ROL_JETTON_MASTER}</code>`,
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboardRows }
    }
  );
});

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(chatId, "⛔ هذا الأمر مخصص للمشرف فقط.");
  }
  await bot.sendMessage(chatId, formatAdminPanelMessage(), {
    parse_mode: "HTML",
    reply_markup: getAdminKeyboard()
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;
  const data = query.data || "";

  if (!chatId || !userId) return;

  if (data.startsWith("admin_") && !isAdmin(userId)) {
    return bot.answerCallbackQuery(query.id, { text: "⛔ للمشرف فقط", show_alert: true });
  }

  if (data === "admin_panel_open") {
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, formatAdminPanelMessage(), {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (data === "admin_stats") {
    await bot.answerCallbackQuery(query.id, { text: "تم تحديث الإحصائيات" });
    return bot.sendMessage(chatId, formatAdminPanelMessage(), {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (data === "admin_add_refs") {
    adminStates.set(String(userId), { step: "awaiting_ref_target" });
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(
      chatId,
      "➕ <b>إضافة إحالات موثقة لمستخدم</b>\n\n" +
        "أرسل الآن معرف المستخدم وعدد الإحالات الموثقة المراد إضافتها:\n" +
        "<code>معرف_المستخدم عدد_الإحالات</code>\n\n" +
        "مثال:\n<code>8586030968 10</code>\n\n" +
        "لإلغاء العملية أرسل: <code>/cancel</code>",
      { parse_mode: "HTML" }
    );
  }

  if (data === "admin_backup") {
    await bot.answerCallbackQuery(query.id, { text: "جاري إرسال النسخة الاحتياطية..." });
    return sendBackupFile(chatId);
  }

  if (data === "admin_toggle_maint") {
    store.system = store.system || {};
    store.system.maintenanceEnabled = !Boolean(store.system.maintenanceEnabled);
    saveStore();
    await bot.answerCallbackQuery(query.id, {
      text: store.system.maintenanceEnabled ? "تم تفعيل وضع الصيانة" : "تم إيقاف وضع الصيانة"
    });
    return bot.sendMessage(chatId, formatAdminPanelMessage(), {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (data === "admin_top100") {
    await bot.answerCallbackQuery(query.id);
    const sorted = Object.values(store.users || {})
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
      .slice(0, 20);
    const lines = sorted.map(
      (u, i) => `${i + 1}. <code>${u.uid}</code> (${u.username ? "@" + u.username : u.firstName || "Miner"}) — <b>${Number(u.balance || 0).toFixed(2)} ROL</b>`
    );
    return bot.sendMessage(
      chatId,
      `🏆 <b>أعلى 20 رصيداً داخل البوت:</b>\n\n${lines.length ? lines.join("\n") : "لا توجد أرصدة بعد."}`,
      { parse_mode: "HTML", reply_markup: getAdminKeyboard() }
    );
  }

  if (data === "admin_withdrawals") {
    await bot.answerCallbackQuery(query.id);
    const pending = (store.withdrawals || []).filter((w) => w.status === "pending");
    if (!pending.length) {
      return bot.sendMessage(chatId, "📭 لا توجد طلبات سحب معلقة حالياً.", {
        reply_markup: getAdminKeyboard()
      });
    }
    const text = pending
      .slice(0, 10)
      .map(
        (w, i) =>
          `${i + 1}. <code>${w.uid}</code> | <b>${w.amount} ROL</b> (صافي: ${w.netAmount} ROL)\nمحفظة: <code>${w.address}</code>`
      )
      .join("\n\n");
    return bot.sendMessage(chatId, `📩 <b>طلبات السحب المعلقة (${pending.length}):</b>\n\n${text}`, {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (data === "admin_tasks") {
    await bot.answerCallbackQuery(query.id);
    const list = store.tasks || [];
    if (!list.length) {
      return bot.sendMessage(chatId, "📋 لا توجد مهام مسجلة حالياً.", {
        reply_markup: getAdminKeyboard()
      });
    }
    const formatted = list
      .slice(0, 15)
      .map((t, idx) => {
        const done = Number(t.completedCount || 0);
        const target = Number(t.targetUsers || 0);
        const status = done >= target ? "✅ منتهية" : "🟢 نشطة";
        return `${idx + 1}. <b>${t.label || t.url}</b> — ${status}\n👥 المنفذون: ${done} / ${target} | المكافأة: ${t.rewardRol || 10} ROL\n🔗 ${t.url}`;
      })
      .join("\n\n");
    return bot.sendMessage(chatId, `📋 <b>تقرير المهام (الحالية والسابقة):</b>\n\n${formatted}`, {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (data === "admin_ban" || data === "admin_unban" || data === "admin_add_tester" || data === "admin_history") {
    adminStates.set(String(userId), { step: data });
    await bot.answerCallbackQuery(query.id);
    const prompts = {
      admin_ban: "🚫 أرسل معرف المستخدم (User ID) لحظر حسابه:",
      admin_unban: "✅ أرسل معرف المستخدم (User ID) لإلغاء حظره:",
      admin_add_tester: "🧪 أرسل معرف المستخدم (User ID) لإضافته إلى قائمة المختبرين المسموح لهم أثناء الصيانة:",
      admin_history: "🗂️ أرسل معرف المستخدم (User ID) لعرض آخر العمليات في سجله:"
    };
    return bot.sendMessage(chatId, `${prompts[data]}\n\nلإلغاء العملية أرسل: <code>/cancel</code>`, {
      parse_mode: "HTML"
    });
  }

  if (data === "admin_reset_confirm") {
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(
      chatId,
      "⚠️ <b>تأكيد تصفير جميع الأرصدة</b>\nهذا الإجراء سيصفّر أرصدة وجلسات التعدين لجميع المستخدمين. هل أنت متأكد؟",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "⚠️ نعم، صفّر جميع الأرصدة", callback_data: "admin_reset_execute" },
              { text: "إلغاء", callback_data: "admin_panel_open" }
            ]
          ]
        }
      }
    );
  }

  if (data === "admin_reset_execute") {
    Object.values(store.users || {}).forEach((u) => {
      u.balance = 0;
      u.startTime = 0;
    });
    saveStore();
    await bot.answerCallbackQuery(query.id, { text: "تم تصفير جميع الأرصدة" });
    return bot.sendMessage(chatId, "✅ تم تصفير أرصدة جميع المستخدمين.", {
      reply_markup: getAdminKeyboard()
    });
  }
});

bot.on("message", async (msg) => {
  if (!msg || !msg.from || !msg.text) return;
  const senderId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (!isAdmin(senderId)) return;

  const state = adminStates.get(senderId);
  if (!state) return;

  if (text.toLowerCase() === "/cancel") {
    adminStates.delete(senderId);
    return bot.sendMessage(chatId, "❌ تم إلغاء العملية.", {
      reply_markup: getAdminKeyboard()
    });
  }

  if (state.step === "awaiting_ref_target") {
    const parts = text.split(/\s+/);
    const targetUid = String(parts[0] || "").trim();
    const addCount = parseInt(parts[1] || "0", 10);

    if (!targetUid || isNaN(addCount) || addCount <= 0) {
      return bot.sendMessage(
        chatId,
        "⚠️ الصيغة غير صحيحة. أرسل المعرف متبوعاً بعدد صحيح أكبر من 0، مثل:\n<code>8586030968 10</code>",
        { parse_mode: "HTML" }
      );
    }

    const targetUser = ensureUserRecord(targetUid);
    targetUser.referralsList = Array.isArray(targetUser.referralsList) ? targetUser.referralsList : [];

    for (let i = 0; i < addCount; i++) {
      targetUser.referralsList.push({
        uid: `boost_${targetUid}_${Date.now()}_${i}`,
        firstName: `Verified Miner #${targetUser.referralsList.length + 1}`,
        username: "",
        verified: true,
        joinedAt: Date.now(),
        verifiedAt: Date.now(),
        adminBoosted: true
      });
    }

    targetUser.refCount = targetUser.referralsList.filter((r) => Boolean(r && r.verified)).length;
    targetUser.updatedAt = Date.now();
    saveStore();
    adminStates.delete(senderId);

    return bot.sendMessage(
      chatId,
      `✅ <b>تمت إضافة ${addCount} إحالات موثقة بنجاح!</b>\n\n` +
        `• المستخدم: <code>${targetUid}</code> (${targetUser.username ? "@" + targetUser.username : targetUser.firstName})\n` +
        `• إجمالي الإحالات الموثقة الآن: <b>${targetUser.refCount}</b>\n\n` +
        `سيظهر التحديث فوراً في صفحة <b>TOP 20 Referrers</b>.`,
      {
        parse_mode: "HTML",
        reply_markup: getAdminKeyboard()
      }
    );
  }

  if (state.step === "admin_ban") {
    const u = ensureUserRecord(text);
    u.banned = true;
    saveStore();
    adminStates.delete(senderId);
    return bot.sendMessage(chatId, `🚫 تم حظر المستخدم <code>${text}</code>.`, {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (state.step === "admin_unban") {
    const u = ensureUserRecord(text);
    u.banned = false;
    saveStore();
    adminStates.delete(senderId);
    return bot.sendMessage(chatId, `✅ تم إلغاء حظر المستخدم <code>${text}</code>.`, {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (state.step === "admin_add_tester") {
    store.system.allowedTesters = Array.isArray(store.system.allowedTesters)
      ? store.system.allowedTesters
      : [];
    if (!store.system.allowedTesters.includes(text)) {
      store.system.allowedTesters.push(text);
      saveStore();
    }
    adminStates.delete(senderId);
    return bot.sendMessage(chatId, `🧪 تمت إضافة <code>${text}</code> إلى قائمة المختبرين.`, {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }

  if (state.step === "admin_history") {
    const u = store.users?.[text];
    adminStates.delete(senderId);
    if (!u || !Array.isArray(u.history) || !u.history.length) {
      return bot.sendMessage(chatId, `🗂️ لا يوجد سجل عمليات للمستخدم <code>${text}</code>.`, {
        parse_mode: "HTML",
        reply_markup: getAdminKeyboard()
      });
    }
    const recent = u.history
      .slice(-8)
      .reverse()
      .map((h) => `• ${h.source}: <b>${h.amount} ROL</b> (${h.details || ""})`)
      .join("\n");
    return bot.sendMessage(chatId, `🗂️ <b>سجل المستخدم <code>${text}</code>:</b>\n\n${recent}`, {
      parse_mode: "HTML",
      reply_markup: getAdminKeyboard()
    });
  }
});

app.get("/api/check-channel", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ joined: false });
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL, Number(userId));
    const joined = ["creator", "administrator", "member", "restricted"].includes(member.status);
    return res.json({ joined });
  } catch (err) {
    return res.json({ joined: false });
  }
});

app.get("/api/avatar", async (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(404).end();

  const cached = avatarCache.get(uid);
  if (cached && Date.now() - cached.ts < 3600000) {
    res.setHeader("Content-Type", cached.mime || "image/jpeg");
    return res.send(cached.buffer);
  }

  try {
    const photos = await bot.getUserProfilePhotos(Number(uid), { limit: 1 });
    if (photos && photos.total_count > 0 && photos.photos[0]?.length > 0) {
      const sizes = photos.photos[0];
      const bestPhoto = sizes[sizes.length - 1];
      const fileLink = await bot.getFileLink(bestPhoto.file_id);
      const response = await fetch(fileLink);
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const mime = response.headers.get("content-type") || "image/jpeg";
        avatarCache.set(uid, { buffer, mime, ts: Date.now() });
        res.setHeader("Content-Type", mime);
        return res.send(buffer);
      }
    }
  } catch (e) {}

  return res.status(404).end();
});

app.get("/api/top-referrals", (req, res) => {
  const contest = normalizeContestWindow();
  saveStore();
  res.json({
    ok: true,
    top20: getTop20List(),
    contest
  });
});

app.get("/api/user", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  const contest = normalizeContestWindow();
  if (!uid) {
    return res.json({
      ok: true,
      system: store.system,
      contest
    });
  }
  const u = store.users?.[uid] || null;
  if (u) {
    u.refCount = getVerifiedCountForUser(u);
  }
  res.json({
    ok: true,
    user: u,
    system: store.system,
    contest
  });
});

app.post("/api/sync-user", (req, res) => {
  const body = req.body || {};
  const uid = String(body.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "Missing uid" });

  const u = ensureUserRecord(uid, {
    username: body.username || "",
    firstName: body.firstName || ""
  });

  if (typeof body.balance === "number" && !Number.isNaN(body.balance)) {
    u.balance = Number(body.balance);
  }
  if (typeof body.vip === "number") u.vip = body.vip;
  if (typeof body.dailyProfit24h === "number") u.dailyProfit24h = body.dailyProfit24h;
  if (typeof body.onChainWalletROL === "number") u.onChainWalletROL = body.onChainWalletROL;
  if (typeof body.wallet === "string") u.wallet = body.wallet;
  if (typeof body.isVerified === "boolean") u.isVerified = body.isVerified;
  if (typeof body.verifyProof === "string") u.verifyProof = body.verifyProof;
  if (typeof body.firstFreeUsed === "boolean") u.firstFreeUsed = body.firstFreeUsed;
  if (typeof body.spinTickets === "number") u.spinTickets = body.spinTickets;
  if (typeof body.startTime === "number") u.startTime = body.startTime;
  if (typeof body.checkinDay === "number") u.checkinDay = body.checkinDay;
  if (typeof body.lastCheckinTime === "number") u.lastCheckinTime = body.lastCheckinTime;
  if (Array.isArray(body.completedTasks)) u.completedTasks = body.completedTasks;

  const listVerified = u.referralsList.filter((r) => Boolean(r && r.verified)).length;
  if (typeof body.refCount === "number") {
    u.refCount = Math.max(Number(body.refCount), listVerified);
  } else {
    u.refCount = listVerified;
  }

  if (typeof body.refEarn === "number") {
    u.refEarn = Math.max(Number(u.refEarn || 0), Number(body.refEarn));
  }

  if (body.historyEntry && typeof body.historyEntry === "object") {
    u.history.push(body.historyEntry);
    if (u.history.length > 100) {
      u.history = u.history.slice(-100);
    }
  }

  u.updatedAt = Date.now();
  normalizeContestWindow();
  saveStore();
  res.json({ ok: true, user: u });
});

app.post("/api/referral/track", (req, res) => {
  const { referrerId, invitedId, username, firstName } = req.body || {};
  if (!referrerId || !invitedId || String(referrerId) === String(invitedId)) {
    return res.json({ ok: false });
  }
  const refUser = ensureUserRecord(String(referrerId));
  const invitedKey = String(invitedId);
  const existingIdx = refUser.referralsList.findIndex((r) => String(r.uid) === invitedKey);
  if (existingIdx === -1) {
    refUser.referralsList.push({
      uid: invitedKey,
      firstName: firstName || `Miner ${invitedKey}`,
      username: username || "",
      verified: false,
      joinedAt: Date.now()
    });
  } else {
    if (firstName) refUser.referralsList[existingIdx].firstName = firstName;
    if (username) refUser.referralsList[existingIdx].username = username;
  }
  refUser.refCount = getVerifiedCountForUser(refUser);
  saveStore();
  res.json({ ok: true });
});

app.post("/api/referral/confirm", (req, res) => {
  const { referrerId, invitedId, username, firstName } = req.body || {};
  if (!referrerId || !invitedId || String(referrerId) === String(invitedId)) {
    return res.json({ ok: false });
  }
  const refUser = ensureUserRecord(String(referrerId));
  const invitedKey = String(invitedId);
  let item = refUser.referralsList.find((r) => String(r.uid) === invitedKey);
  if (!item) {
    item = {
      uid: invitedKey,
      firstName: firstName || `Miner ${invitedKey}`,
      username: username || "",
      verified: false,
      joinedAt: Date.now()
    };
    refUser.referralsList.push(item);
  }

  if (!item.verified) {
    item.verified = true;
    item.verifiedAt = Date.now();
    refUser.balance = Number((Number(refUser.balance || 0) + REFERRAL_BONUS_ROL).toFixed(2));
    refUser.refEarn = Number((Number(refUser.refEarn || 0) + REFERRAL_BONUS_ROL).toFixed(2));
    refUser.spinTickets = Number(refUser.spinTickets || 0) + REFERRAL_BONUS_SPINS;
    refUser.history.push({
      source: "Verified Referral Bonus",
      amount: REFERRAL_BONUS_ROL,
      details: `Invited user ${invitedKey} (+${REFERRAL_BONUS_SPINS} Spin)`,
      timestamp: Date.now()
    });
  }

  refUser.refCount = getVerifiedCountForUser(refUser);
  saveStore();
  res.json({ ok: true, refCount: refUser.refCount });
});

app.get("/api/tasks", (req, res) => {
  store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
  const active = store.tasks.filter(
    (t) => Number(t.completedCount || 0) < Number(t.targetUsers || 0)
  );
  res.json({ ok: true, tasks: active });
});

app.post("/api/tasks", (req, res) => {
  const task = req.body || {};
  if (!task.id || !task.url || !task.targetUsers) {
    return res.status(400).json({ ok: false, error: "Invalid task payload" });
  }
  store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
  const exists = store.tasks.find((t) => t.id === task.id);
  if (!exists) {
    const newTask = {
      id: String(task.id),
      url: String(task.url),
      label: String(task.label || task.url),
      targetUsers: Number(task.targetUsers),
      completedCount: Number(task.completedCount || 0),
      rewardRol: Number(task.rewardRol || CUSTOM_TASK_REWARD_ROL),
      paidGram: Number(task.paidGram || 0),
      createdBy: String(task.createdBy || ""),
      createdAt: Number(task.createdAt || Date.now()),
      completedBy: []
    };
    store.tasks.unshift(newTask);
    saveStore();
    return res.json({ ok: true, task: newTask });
  }
  res.json({ ok: true, task: exists });
});

app.post("/api/tasks/complete", (req, res) => {
  const { taskId, uid } = req.body || {};
  store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
  const idx = store.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    return res.json({ ok: false, expired: true });
  }
  const task = store.tasks[idx];
  task.completedBy = Array.isArray(task.completedBy) ? task.completedBy : [];
  if (uid && task.completedBy.includes(String(uid))) {
    return res.json({ ok: true, alreadyCompleted: true });
  }
  if (Number(task.completedCount || 0) >= Number(task.targetUsers || 0)) {
    return res.json({ ok: false, expired: true });
  }
  if (uid) task.completedBy.push(String(uid));
  task.completedCount = Number(task.completedCount || 0) + 1;
  saveStore();
  res.json({ ok: true, rewardRol: Number(task.rewardRol || CUSTOM_TASK_REWARD_ROL) });
});

app.post("/api/withdraw", (req, res) => {
  const body = req.body || {};
  const amount = Number(body.amount || 0);
  if (!body.uid || !body.address || amount < MIN_WITHDRAW_ROL) {
    return res.status(400).json({ ok: false, error: "Invalid withdrawal request" });
  }
  store.withdrawals = Array.isArray(store.withdrawals) ? store.withdrawals : [];
  const record = {
    id: body.id || `wd_${body.uid}_${Date.now()}`,
    uid: String(body.uid),
    username: body.username || "",
    amount: amount,
    feePercent: 5,
    feeAmount: Number((amount * 0.05).toFixed(2)),
    netAmount: Number((amount * 0.95).toFixed(2)),
    requiredWalletHold: Number((amount * 0.25).toFixed(2)),
    onChainWalletROL: Number(body.onChainWalletROL || 0),
    address: String(body.address),
    network: "TON",
    status: "pending",
    createdAt: Date.now()
  };
  store.withdrawals.unshift(record);
  saveStore();
  res.json({ ok: true, withdrawal: record });
});

app.get("/", (req, res) => {
  res.send("ROL Mining Bot Server is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
