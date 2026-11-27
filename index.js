const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const BOT_TOKEN = process.env.BOT_TOKEN || "9185746835:AAFSJXdgMJI_SH-klpoTpowKMzDQocSOqVo";
const ADMIN_IDS = ["1932161126"];
const REQUIRED_CHANNEL = "@ROL_TOKN";
const REQUIRED_CHANNEL_URL = "https://t.me/ROL_TOKN";
const MINI_APP_URL = process.env.MINI_APP_URL || "https://fruit-titan.github.io/fruit-titan-app/";
const ROL_JETTON_MASTER = "EQApOJVuhW8SIGHYAEdYOGvefbBf8r6IiApqyoffbbjXOIFc";
const VERIFY_DEST_WALLET = "UQCYWzbDk673PWtuz_hwDq9WhGdS9Nz_Ppe-DLIFdNb5BsAb";

const DATA_FILE = path.join(__dirname, 'rol_bot_data.json');
const BACKUP_FILE = path.join(__dirname, 'rol_bot_data.backup.json');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const SECRET_PROMO_CODES = {
  "ROL10K": { rewardRol: 2500, maxClaims: 500 },
  "ROL2500": { rewardRol: 2500, maxClaims: 500 }
};

function createDefaultDB() {
  return {
    users: {},
    tasks: [],
    withdrawals: [],
    promoUsage: {},
    contest: {
      startedAt: Date.now(),
      endsAt: Date.now() + WEEK_MS
    },
    system: {
      maintenanceEnabled: false,
      maintenanceMessage: "نقوم حالياً بتحديث النظام وتحسين الأداء. سنعود للعمل قريباً.",
      allowedTesters: []
    }
  };
}

let db = createDefaultDB();

function saveDB() {
  try {
    db.contest = db.contest || { startedAt: Date.now(), endsAt: Date.now() + WEEK_MS };
    if (!Number(db.contest.endsAt) || Number(db.contest.endsAt) <= Date.now()) {
      db.contest.startedAt = Date.now();
      db.contest.endsAt = Date.now() + WEEK_MS;
    }
    const serialized = JSON.stringify(db, null, 2);
    fs.writeFileSync(DATA_FILE, serialized, 'utf8');
    fs.writeFileSync(BACKUP_FILE, serialized, 'utf8');
  } catch (err) {
    console.error("Error saving DB:", err.message);
  }
}

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db = {
        ...createDefaultDB(),
        ...parsed,
        users: parsed.users || {},
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        withdrawals: Array.isArray(parsed.withdrawals) ? parsed.withdrawals : [],
        promoUsage: parsed.promoUsage && typeof parsed.promoUsage === 'object' ? parsed.promoUsage : {},
        contest: {
          startedAt: Number(parsed.contest?.startedAt) || Date.now(),
          endsAt: Number(parsed.contest?.endsAt) > Date.now()
            ? Number(parsed.contest.endsAt)
            : Date.now() + WEEK_MS
        },
        system: {
          ...createDefaultDB().system,
          ...(parsed.system || {}),
          allowedTesters: Array.isArray(parsed.system?.allowedTesters) ? parsed.system.allowedTesters.map(String) : []
        }
      };
    } else {
      saveDB();
    }
  } catch (err) {
    console.error("Error loading DB:", err.message);
    db = createDefaultDB();
    saveDB();
  }
}

loadDB();

function isAdmin(uid) {
  return ADMIN_IDS.includes(String(uid));
}

function isTesterOrAdmin(uid) {
  const s = String(uid);
  return isAdmin(s) || (db.system?.allowedTesters || []).map(String).includes(s);
}

function ensureUser(uid, username = "", firstName = "Miner") {
  const key = String(uid);
  if (!db.users[key]) {
    db.users[key] = {
      uid: key,
      username: username || "",
      firstName: firstName || "Miner",
      photoUrl: "",
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
      referredBy: "",
      referralsList: [],
      redeemedCodes: [],
      banned: false,
      banReason: "",
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  } else {
    if (username) db.users[key].username = username;
    if (firstName) db.users[key].firstName = firstName;
    if (!Array.isArray(db.users[key].referralsList)) db.users[key].referralsList = [];
    if (!Array.isArray(db.users[key].redeemedCodes)) db.users[key].redeemedCodes = [];
    if (!Array.isArray(db.users[key].history)) db.users[key].history = [];
    if (typeof db.users[key].photoUrl !== 'string') db.users[key].photoUrl = "";
  }
  return db.users[key];
}

function appendUserHistory(u, source, amount, details = "") {
  u.history = Array.isArray(u.history) ? u.history : [];
  u.history.push({
    source: String(source || 'Activity'),
    amount: Number(Number(amount || 0).toFixed(2)),
    details: String(details || ''),
    balanceAfter: Number(Number(u.balance || 0).toFixed(2)),
    timestamp: Date.now()
  });
  if (u.history.length > 100) {
    u.history = u.history.slice(-100);
  }
}

function autoBanSharedWalletIfNeeded(targetUser, walletAddress) {
  const cleanAddr = String(walletAddress || '').trim();
  if (!cleanAddr) return false;
  for (const [otherId, otherUser] of Object.entries(db.users)) {
    if (String(otherId) !== String(targetUser.uid) && String(otherUser.wallet || '').trim() === cleanAddr) {
      targetUser.banned = true;
      targetUser.banReason = `Shared TON wallet across accounts (${cleanAddr})`;
      return true;
    }
  }
  return false;
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const avatarCache = new Map();
const adminPendingAction = new Map();

bot.on('polling_error', (err) => {
  console.error("Telegram polling_error:", err.message);
});

async function resolveUserPhotoUrl(targetUid) {
  const key = String(targetUid);
  if (!key || key.startsWith('boost_') || key.startsWith('slot_')) return "";
  const cached = avatarCache.get(key);
  if (cached && (Date.now() - cached.ts) < 3600000) {
    return cached.url;
  }
  try {
    const numericId = Number(key);
    if (!Number.isFinite(numericId) || numericId <= 0) return "";
    const photos = await bot.getUserProfilePhotos(numericId, { limit: 1 });
    if (photos && photos.total_count > 0 && photos.photos[0]?.length > 0) {
      const sizes = photos.photos[0];
      const bestPhoto = sizes[sizes.length - 1];
      const fileLink = await bot.getFileLink(bestPhoto.file_id);
      if (fileLink) {
        avatarCache.set(key, { url: fileLink, ts: Date.now() });
        if (db.users[key]) {
          db.users[key].photoUrl = fileLink;
        }
        return fileLink;
      }
    }
  } catch (e) {}
  return db.users[key]?.photoUrl || "";
}

function getDefaultAvatarSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#091d42"/><circle cx="48" cy="36" r="16" fill="#00f0ff" opacity="0.8"/><path d="M20 80c2-16 14-26 28-26s26 10 28 26" fill="#facc15" opacity="0.85"/></svg>`;
}

app.get('/api/avatar', async (req, res) => {
  try {
    const targetUid = String(req.query.uid || '').trim();
    const photoUrl = await resolveUserPhotoUrl(targetUid);
    if (photoUrl) {
      const imgResp = await fetch(photoUrl);
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
        const arrayBuf = await imgResp.arrayBuffer();
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=1800');
        return res.send(Buffer.from(arrayBuf));
      }
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(getDefaultAvatarSvg());
  } catch (err) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(getDefaultAvatarSvg());
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ROL Mining Bot Server is running.');
});

app.get('/api/check-channel', async (req, res) => {
  try {
    const userId = String(req.query.userId || '').trim();
    if (!userId) return res.json({ joined: false });
    const member = await bot.getChatMember(REQUIRED_CHANNEL, Number(userId));
    const joined = ['member', 'administrator', 'creator'].includes(member.status);
    return res.json({ joined });
  } catch (err) {
    return res.json({ joined: false });
  }
});

app.get('/api/tasks', (req, res) => {
  const activeTasks = (db.tasks || []).filter(t => Number(t.completedCount || 0) < Number(t.targetUsers || 0));
  res.json({ ok: true, tasks: activeTasks });
});

app.post('/api/tasks', (req, res) => {
  try {
    const body = req.body || {};
    const targetUsers = parseInt(body.targetUsers || '0', 10);
    if (!body.url || isNaN(targetUsers) || targetUsers < 50) {
      return res.status(400).json({ ok: false, error: 'invalid_task' });
    }
    const taskObj = {
      id: body.id || `ctask_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      url: String(body.url).trim(),
      label: String(body.label || body.url).trim(),
      targetUsers,
      completedCount: 0,
      rewardRol: 10,
      paidGram: Number(body.paidGram || ((targetUsers / 50) * 1).toFixed(4)),
      createdBy: String(body.createdBy || ''),
      completedBy: [],
      createdAt: Date.now()
    };
    db.tasks = db.tasks || [];
    db.tasks.unshift(taskObj);
    saveDB();
    return res.json({ ok: true, task: taskObj });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

app.post('/api/tasks/complete', (req, res) => {
  try {
    const taskId = String(req.body?.taskId || '');
    const userId = String(req.body?.uid || '');
    const idx = (db.tasks || []).findIndex(t => String(t.id) === taskId);
    if (idx === -1) {
      return res.json({ ok: true, rewardRol: 10 });
    }
    const task = db.tasks[idx];
    task.completedBy = Array.isArray(task.completedBy) ? task.completedBy : [];
    const currentCount = Number(task.completedCount || 0);
    const maxCount = Number(task.targetUsers || 0);

    if (currentCount >= maxCount) {
      db.tasks.splice(idx, 1);
      saveDB();
      return res.json({ ok: false, expired: true });
    }

    if (userId && task.completedBy.includes(userId)) {
      return res.json({ ok: true, alreadyCompleted: true, rewardRol: 10 });
    }

    if (userId) task.completedBy.push(userId);
    task.completedCount = currentCount + 1;
    if (task.completedCount >= maxCount) {
      db.tasks.splice(idx, 1);
    }
    saveDB();
    return res.json({ ok: true, rewardRol: 10 });
  } catch (err) {
    return res.json({ ok: true, rewardRol: 10 });
  }
});

app.get('/api/user', (req, res) => {
  const userId = String(req.query.uid || '').trim();
  const u = userId ? db.users[userId] : null;
  res.json({
    ok: true,
    user: u || null,
    contest: db.contest,
    system: db.system
  });
});

app.post('/api/sync-user', (req, res) => {
  try {
    const body = req.body || {};
    const userId = String(body.uid || '').trim();
    if (!userId) return res.status(400).json({ ok: false });

    const u = ensureUser(userId, body.username || "", body.firstName || "Miner");

    if (typeof body.balance === 'number' && !isNaN(body.balance)) u.balance = Number(body.balance.toFixed(2));
    if (typeof body.vip === 'number' && !isNaN(body.vip)) u.vip = body.vip;
    if (typeof body.dailyProfit24h === 'number' && !isNaN(body.dailyProfit24h)) u.dailyProfit24h = body.dailyProfit24h;
    if (typeof body.onChainWalletROL === 'number' && !isNaN(body.onChainWalletROL)) u.onChainWalletROL = body.onChainWalletROL;
    if (typeof body.wallet === 'string') {
      u.wallet = body.wallet.trim();
      if (u.wallet) autoBanSharedWalletIfNeeded(u, u.wallet);
    }
    if (typeof body.isVerified === 'boolean') u.isVerified = body.isVerified;
    if (typeof body.verifyProof === 'string' && body.verifyProof) u.verifyProof = body.verifyProof;
    if (typeof body.firstFreeUsed === 'boolean') u.firstFreeUsed = body.firstFreeUsed;
    if (typeof body.spinTickets === 'number' && !isNaN(body.spinTickets)) u.spinTickets = body.spinTickets;
    if (typeof body.startTime === 'number' && !isNaN(body.startTime)) u.startTime = body.startTime;
    if (typeof body.checkinDay === 'number' && !isNaN(body.checkinDay)) u.checkinDay = body.checkinDay;
    if (typeof body.lastCheckinTime === 'number' && !isNaN(body.lastCheckinTime)) u.lastCheckinTime = body.lastCheckinTime;
    if (Array.isArray(body.completedTasks)) u.completedTasks = body.completedTasks;
    if (typeof body.refCount === 'number' && !isNaN(body.refCount)) u.refCount = body.refCount;
    if (typeof body.refEarn === 'number' && !isNaN(body.refEarn)) u.refEarn = Number(body.refEarn.toFixed(2));

    if (body.historyEntry && typeof body.historyEntry === 'object') {
      appendUserHistory(
        u,
        body.historyEntry.source || 'Activity',
        body.historyEntry.amount || 0,
        body.historyEntry.details || ''
      );
    }

    u.updatedAt = Date.now();
    saveDB();
    return res.json({ ok: true, user: u });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

app.post('/api/promo/redeem', (req, res) => {
  try {
    const uidStr = String(req.body?.uid || '').trim();
    const rawCode = String(req.body?.code || '').trim().toUpperCase();
    if (!uidStr || !rawCode) {
      return res.status(400).json({ ok: false, error: 'missing_params' });
    }

    const promoCfg = SECRET_PROMO_CODES[rawCode];
    if (!promoCfg) {
      return res.status(404).json({ ok: false, error: 'invalid_code' });
    }

    const u = ensureUser(uidStr, req.body?.username || '', req.body?.firstName || 'Miner');
    if (u.banned) {
      return res.status(403).json({ ok: false, error: 'user_banned' });
    }

    u.redeemedCodes = Array.isArray(u.redeemedCodes) ? u.redeemedCodes : [];
    if (u.redeemedCodes.includes(rawCode)) {
      return res.status(409).json({ ok: false, error: 'already_redeemed' });
    }

    db.promoUsage = db.promoUsage || {};
    const currentClaims = Number(db.promoUsage[rawCode] || 0);
    if (currentClaims >= promoCfg.maxClaims) {
      return res.status(410).json({ ok: false, error: 'limit_reached' });
    }

    db.promoUsage[rawCode] = currentClaims + 1;
    u.redeemedCodes.push(rawCode);
    u.balance = Number((Number(u.balance || 0) + promoCfg.rewardRol).toFixed(2));
    appendUserHistory(u, 'Secret Promo Code', promoCfg.rewardRol, `Code ${rawCode}`);
    u.updatedAt = Date.now();
    saveDB();

    return res.json({
      ok: true,
      code: rawCode,
      rewardRol: promoCfg.rewardRol,
      balance: u.balance,
      history: u.history
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/api/referral/track', (req, res) => {
  try {
    const referrerId = String(req.body?.referrerId || '').trim();
    const invitedId = String(req.body?.invitedId || '').trim();
    if (!referrerId || !invitedId || referrerId === invitedId) {
      return res.json({ ok: false });
    }

    const refUser = ensureUser(referrerId);
    const invUser = ensureUser(invitedId, req.body?.username || '', req.body?.firstName || 'Miner');

    if (!invUser.referredBy) {
      invUser.referredBy = referrerId;
    }

    const exists = refUser.referralsList.find(r => String(r.uid) === invitedId);
    if (!exists) {
      refUser.referralsList.push({
        uid: invitedId,
        username: invUser.username || req.body?.username || "",
        firstName: invUser.firstName || req.body?.firstName || "Miner",
        photoUrl: invUser.photoUrl || "",
        verified: Boolean(invUser.isVerified),
        joinedAt: Date.now()
      });
    }

    saveDB();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

app.post('/api/referral/confirm', (req, res) => {
  try {
    const referrerId = String(req.body?.referrerId || '').trim();
    const invitedId = String(req.body?.invitedId || '').trim();
    if (!referrerId || !invitedId || referrerId === invitedId) {
      return res.json({ ok: false });
    }

    const refUser = ensureUser(referrerId);
    const invUser = ensureUser(invitedId, req.body?.username || '', req.body?.firstName || 'Miner');
    invUser.isVerified = true;
    invUser.referredBy = invUser.referredBy || referrerId;

    let item = refUser.referralsList.find(r => String(r.uid) === invitedId);
    if (!item) {
      item = {
        uid: invitedId,
        username: invUser.username || "",
        firstName: invUser.firstName || "Miner",
        photoUrl: invUser.photoUrl || "",
        verified: false,
        joinedAt: Date.now()
      };
      refUser.referralsList.push(item);
    }

    if (!item.verified) {
      item.verified = true;
      item.verifiedAt = Date.now();
      refUser.refCount = Number(refUser.refCount || 0) + 1;
      refUser.refEarn = Number((Number(refUser.refEarn || 0) + 60).toFixed(2));
      refUser.balance = Number((Number(refUser.balance || 0) + 60).toFixed(2));
      refUser.spinTickets = Number(refUser.spinTickets || 0) + 1;
      appendUserHistory(refUser, 'Verified Referral', 60, `From @${invUser.username || invitedId} (+1 Spin)`);
      saveDB();
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

app.get('/api/top-referrals', async (req, res) => {
  try {
    const entries = [];
    for (const u of Object.values(db.users || {})) {
      const list = Array.isArray(u.referralsList) ? u.referralsList : [];
      const verifiedCount = list.filter(r => Boolean(r.verified)).length;
      const effectiveRefs = Math.max(Number(u.refCount || 0), verifiedCount);
      if (effectiveRefs > 0) {
        entries.push({
          uid: String(u.uid),
          username: u.username || "",
          firstName: u.firstName || "Miner",
          photoUrl: u.photoUrl || "",
          verifiedReferrals: effectiveRefs
        });
      }
    }

    entries.sort((a, b) => b.verifiedReferrals - a.verifiedReferrals);
    const top20 = entries.slice(0, 20);

    for (let i = 0; i < Math.min(top20.length, 5); i++) {
      if (!top20[i].photoUrl) {
        top20[i].photoUrl = await resolveUserPhotoUrl(top20[i].uid);
      }
    }

    return res.json({
      ok: true,
      top20,
      contest: db.contest
    });
  } catch (err) {
    return res.status(500).json({ ok: false, top20: [] });
  }
});

app.post('/api/withdraw', async (req, res) => {
  try {
    const body = req.body || {};
    const userId = String(body.uid || '').trim();
    const amount = Number(parseFloat(body.amount || '0').toFixed(2));
    const address = String(body.address || '').trim();

    if (!userId || isNaN(amount) || amount < 10000 || !address) {
      return res.status(400).json({ ok: false, error: 'invalid_withdrawal' });
    }

    const u = ensureUser(userId, body.username || '');
    const sharedBanned = autoBanSharedWalletIfNeeded(u, address);
    if (sharedBanned || u.banned) {
      saveDB();
      return res.status(403).json({ ok: false, error: 'wallet_shared_or_banned' });
    }

    const requiredHold = Number((amount * 0.25).toFixed(2));
    const feeAmount = Number((amount * 0.05).toFixed(2));
    const netAmount = Number((amount * 0.95).toFixed(2));
    const walletRol = Number(body.onChainWalletROL ?? u.onChainWalletROL ?? 0);

    if (walletRol < requiredHold) {
      return res.status(400).json({ ok: false, error: 'insufficient_wallet_hold', requiredHold });
    }

    if (Number(u.balance || 0) >= amount) {
      u.balance = Number((Number(u.balance) - amount).toFixed(2));
      appendUserHistory(u, 'Withdrawal Request', -amount, `Net: ${netAmount} ROL (5% fee)`);
    }

    const wdRecord = {
      id: body.id || `wd_${userId}_${Date.now()}`,
      uid: userId,
      username: body.username || u.username || "",
      amount,
      feePercent: 5,
      feeAmount,
      netAmount,
      requiredWalletHold: requiredHold,
      onChainWalletROL: walletRol,
      address,
      network: "TON",
      status: "pending",
      createdAt: Date.now()
    };

    db.withdrawals = db.withdrawals || [];
    db.withdrawals.unshift(wdRecord);
    saveDB();

    for (const adminId of ADMIN_IDS) {
      try {
        await bot.sendMessage(
          adminId,
          `💸 <b>طلب سحب جديد (ROL)</b>\n\n` +
          `👤 المستخدم: <code>${userId}</code> (${u.username ? '@' + u.username : 'بدون معرف'})\n` +
          `💰 المطلوب سحبه: <b>${amount.toLocaleString('en-US')} ROL</b>\n` +
          `✅ الصافي بعد الرسوم (5%): <b>${netAmount.toLocaleString('en-US')} ROL</b>\n` +
          `🔒 المطلوب في المحفظة (25%): <b>${requiredHold.toLocaleString('en-US')} ROL</b>\n` +
          `👛 المحفظة: <code>${address}</code>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {}
    }

    return res.json({ ok: true, withdrawal: wdRecord, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

function getAdminKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 إحصائيات المستخدمين", callback_data: "admin_stats" },
          { text: "💸 مراجعة السحوبات", callback_data: "admin_withdrawals" }
        ],
        [
          { text: "🏆 حاملي العملة Top 100", callback_data: "admin_top100" },
          { text: "📜 سجل مستخدم (History)", callback_data: "admin_user_history" }
        ],
        [
          { text: "🚫 حظر مستخدم", callback_data: "admin_ban" },
          { text: "✅ إلغاء حظر", callback_data: "admin_unban" }
        ],
        [
          { text: "🧪 إضافة مختبر", callback_data: "admin_add_tester" },
          { text: "🛠️ وضع الصيانة", callback_data: "admin_toggle_maint" }
        ],
        [
          { text: "💾 نسخة احتياطية للبيانات", callback_data: "admin_backup" },
          { text: "➕ إضافة إحالات موثقة", callback_data: "admin_add_refs" }
        ],
        [
          { text: "⚠️ تصفير جميع الأرصدة (Reset)", callback_data: "admin_reset_balances" }
        ]
      ]
    }
  };
}

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from?.id || chatId);
  const param = (match && match[1] ? match[1] : '').trim();

  const u = ensureUser(senderId, msg.from?.username || '', msg.from?.first_name || 'Miner');
  if (param.startsWith('ref_')) {
    const refId = param.replace('ref_', '').trim();
    if (refId && refId !== senderId && !u.referredBy) {
      u.referredBy = refId;
      const refOwner = ensureUser(refId);
      if (!refOwner.referralsList.some(r => String(r.uid) === senderId)) {
        refOwner.referralsList.push({
          uid: senderId,
          username: u.username || "",
          firstName: u.firstName || "Miner",
          photoUrl: u.photoUrl || "",
          verified: Boolean(u.isVerified),
          joinedAt: Date.now()
        });
      }
    }
  }
  await resolveUserPhotoUrl(senderId);
  saveDB();

  if (u.banned) {
    return bot.sendMessage(chatId, "🚫 تم إيقاف هذا الحساب لمخالفة شروط الاستخدام.");
  }

  if (db.system?.maintenanceEnabled && !isTesterOrAdmin(senderId)) {
    return bot.sendMessage(chatId, `🛠️ ${db.system.maintenanceMessage}`);
  }

  await bot.sendMessage(
    chatId,
    `⛏️ مرحباً بك في <b>ROL Mining</b> على شبكة <b>TON</b>!\n\n` +
    `💎 رمز العملة: <code>${ROL_JETTON_MASTER}</code>\n` +
    `📢 القناة الرسمية: ${REQUIRED_CHANNEL_URL}\n` +
    `🔐 كود ترويجي تجريبي: <code>ROL10K</code> (+2,500 ROL)\n\n` +
    `اضغط على الزر أدناه لفتح التطبيق المصغر والبدء بالتعدين:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 فتح تطبيق ROL Mining", web_app: { url: MINI_APP_URL } }],
          [{ text: "📢 الانضمام إلى القناة @ROL_TOKN", url: REQUIRED_CHANNEL_URL }]
        ]
      }
    }
  );
});

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from?.id || chatId);
  if (!isAdmin(senderId)) return;

  await bot.sendMessage(
    chatId,
    `🛡️ <b>لوحة تحكم مشرف ROL Mining</b>\n` +
    `حالة الصيانة: <b>${db.system?.maintenanceEnabled ? 'مفعّلة 🔴' : 'متوقفة 🟢'}</b>`,
    { parse_mode: 'HTML', ...getAdminKeyboard() }
  );
});

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat?.id;
  const senderId = String(query.from?.id || '');
  const data = query.data || '';

  if (!isAdmin(senderId)) {
    return bot.answerCallbackQuery(query.id, { text: "غير مصرح لك", show_alert: true });
  }

  await bot.answerCallbackQuery(query.id);

  if (data === 'admin_stats') {
    const usersArr = Object.values(db.users || {});
    const verifiedCount = usersArr.filter(x => x.isVerified).length;
    const totalBal = usersArr.reduce((acc, x) => acc + Number(x.balance || 0), 0);
    return bot.sendMessage(
      chatId,
      `📊 <b>إحصائيات النظام</b>\n\n` +
      `👥 إجمالي المستخدمين: <b>${usersArr.length}</b>\n` +
      `✅ الحسابات الموثقة: <b>${verifiedCount}</b>\n` +
      `💰 مجموع أرصدة البوت: <b>${totalBal.toLocaleString('en-US')} ROL</b>\n` +
      `⏳ طلبات السحب المعلقة: <b>${(db.withdrawals || []).filter(w => w.status === 'pending').length}</b>`,
      { parse_mode: 'HTML', ...getAdminKeyboard() }
    );
  }

  if (data === 'admin_withdrawals') {
    const pending = (db.withdrawals || []).filter(w => w.status === 'pending').slice(0, 10);
    if (!pending.length) {
      return bot.sendMessage(chatId, "📭 لا توجد طلبات سحب معلقة حالياً.", getAdminKeyboard());
    }
    for (const w of pending) {
      await bot.sendMessage(
        chatId,
        `💳 <b>طلب سحب</b>\n` +
        `المستخدم: <code>${w.uid}</code> (${w.username ? '@' + w.username : '-'})\n` +
        `المبلغ: <b>${w.amount} ROL</b> | الصافي: <b>${w.netAmount} ROL</b>\n` +
        `المحفظة: <code>${w.address}</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ تأكيد الإرسال", callback_data: `wd_approve_${w.id}` },
              { text: "❌ رفض وإرجاع", callback_data: `wd_reject_${w.id}` }
            ]]
          }
        }
      );
    }
    return;
  }

  if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
    const isApprove = data.startsWith('wd_approve_');
    const wdId = data.replace(isApprove ? 'wd_approve_' : 'wd_reject_', '');
    const wd = (db.withdrawals || []).find(item => String(item.id) === wdId);
    if (!wd) return bot.sendMessage(chatId, "⚠️ لم يتم العثور على طلب السحب.");

    wd.status = isApprove ? 'approved' : 'rejected';
    const targetUser = ensureUser(wd.uid);
    if (!isApprove) {
      targetUser.balance = Number((Number(targetUser.balance || 0) + Number(wd.amount || 0)).toFixed(2));
      appendUserHistory(targetUser, 'Withdrawal Refunded', Number(wd.amount || 0), 'Rejected by admin');
    }
    saveDB();
    return bot.sendMessage(
      chatId,
      isApprove ? `✅ تم تأكيد السحب <code>${wdId}</code>` : `❌ تم رفض السحب وإرجاع الرصيد للمستخدم <code>${wd.uid}</code>`,
      { parse_mode: 'HTML', ...getAdminKeyboard() }
    );
  }

  if (data === 'admin_top100') {
    const sorted = Object.values(db.users || {})
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
      .slice(0, 20);
    const lines = sorted.map((u, i) =>
      `${i + 1}. <code>${u.uid}</code> (${u.username ? '@' + u.username : u.firstName || 'Miner'}) — <b>${Number(u.balance || 0).toFixed(2)} ROL</b>`
    );
    return bot.sendMessage(
      chatId,
      `🏆 <b>أعلى 20 رصيداً في البوت</b>\n\n${lines.join('\n') || 'لا توجد بيانات'}`,
      { parse_mode: 'HTML', ...getAdminKeyboard() }
    );
  }

  if (data === 'admin_user_history') {
    adminPendingAction.set(senderId, 'history');
    return bot.sendMessage(chatId, "📜 أرسل معرف المستخدم (<code>UID</code>) لعرض آخر عملياته:", { parse_mode: 'HTML' });
  }

  if (data === 'admin_ban') {
    adminPendingAction.set(senderId, 'ban');
    return bot.sendMessage(chatId, "🚫 أرسل معرف المستخدم (<code>UID</code>) لحظر حسابه:", { parse_mode: 'HTML' });
  }

  if (data === 'admin_unban') {
    adminPendingAction.set(senderId, 'unban');
    return bot.sendMessage(chatId, "✅ أرسل معرف المستخدم (<code>UID</code>) لإلغاء الحظر عنه:", { parse_mode: 'HTML' });
  }

  if (data === 'admin_add_tester') {
    adminPendingAction.set(senderId, 'tester');
    return bot.sendMessage(chatId, "🧪 أرسل معرف المستخدم (<code>UID</code>) لإضافته إلى قائمة المختبرين:", { parse_mode: 'HTML' });
  }

  if (data === 'admin_toggle_maint') {
    db.system.maintenanceEnabled = !Boolean(db.system.maintenanceEnabled);
    saveDB();
    return bot.sendMessage(
      chatId,
      `🛠️ تم ${db.system.maintenanceEnabled ? 'تفعيل 🔴' : 'إيقاف 🟢'} وضع الصيانة.`,
      getAdminKeyboard()
    );
  }

  if (data === 'admin_backup') {
    saveDB();
    if (fs.existsSync(DATA_FILE)) {
      return bot.sendDocument(chatId, DATA_FILE, { caption: "💾 نسخة احتياطية لملف rol_bot_data.json" }, getAdminKeyboard());
    }
    return bot.sendMessage(chatId, "⚠️ ملف البيانات غير موجود حالياً.", getAdminKeyboard());
  }

  if (data === 'admin_add_refs') {
    adminPendingAction.set(senderId, 'add_refs');
    return bot.sendMessage(
      chatId,
      "➕ أرسل معرف المستخدم وعدد الإحالات الموثقة مفصولين بمسافة، مثال:\n<code>8586030968 10</code>",
      { parse_mode: 'HTML' }
    );
  }

  if (data === 'admin_reset_balances') {
    for (const u of Object.values(db.users || {})) {
      u.balance = 0;
      u.startTime = 0;
      appendUserHistory(u, 'Admin Balance Reset', 0, 'Reset by admin');
    }
    saveDB();
    return bot.sendMessage(chatId, "⚠️ تم تصفير جميع أرصدة وجلسات التعدين للمستخدمين.", getAdminKeyboard());
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from?.id || '');
  const text = (msg.text || '').trim();

  if (!text || text.startsWith('/')) return;
  if (!isAdmin(senderId)) return;

  const pendingType = adminPendingAction.get(senderId);
  if (!pendingType) return;
  adminPendingAction.delete(senderId);

  if (pendingType === 'history') {
    const target = db.users[text];
    if (!target) return bot.sendMessage(chatId, "⚠️ المستخدم غير موجود.", getAdminKeyboard());
    const recent = (target.history || []).slice(-10).reverse();
    const formatted = recent.map(h => `• <b>${h.source}</b>: ${h.amount >= 0 ? '+' : ''}${h.amount} ROL (${h.details || ''})`).join('\n');
    return bot.sendMessage(
      chatId,
      `📜 <b>سجل المستخدم ${text}</b>\nالرصيد الحالي: <b>${target.balance} ROL</b>\n\n${formatted || 'لا توجد عمليات مسجلة'}`,
      { parse_mode: 'HTML', ...getAdminKeyboard() }
    );
  }

  if (pendingType === 'ban') {
    const target = ensureUser(text);
    target.banned = true;
    target.banReason = "Banned by admin";
    saveDB();
    return bot.sendMessage(chatId, `🚫 تم حظر المستخدم <code>${text}</code>.`, { parse_mode: 'HTML', ...getAdminKeyboard() });
  }

  if (pendingType === 'unban') {
    const target = ensureUser(text);
    target.banned = false;
    target.banReason = "";
    saveDB();
    return bot.sendMessage(chatId, `✅ تم إلغاء الحظر عن المستخدم <code>${text}</code>.`, { parse_mode: 'HTML', ...getAdminKeyboard() });
  }

  if (pendingType === 'tester') {
    db.system.allowedTesters = db.system.allowedTesters || [];
    if (!db.system.allowedTesters.includes(text)) {
      db.system.allowedTesters.push(text);
      saveDB();
    }
    return bot.sendMessage(chatId, `🧪 تمت إضافة <code>${text}</code> إلى قائمة المختبرين.`, { parse_mode: 'HTML', ...getAdminKeyboard() });
  }

  if (pendingType === 'add_refs') {
    const parts = text.split(/\s+/);
    const targetUid = String(parts[0] || '').trim();
    const addNum = parseInt(parts[1] || '0', 10);

    if (!targetUid || isNaN(addNum) || addNum <= 0) {
      return bot.sendMessage(chatId, "⚠️ صيغة غير صحيحة. اكتب: <code>معرف_المستخدم عدد_الإحالات</code>", { parse_mode: 'HTML', ...getAdminKeyboard() });
    }

    const targetUser = ensureUser(targetUid);
    targetUser.refCount = Number(targetUser.refCount || 0) + addNum;
    const bonusRol = addNum * 60;
    targetUser.balance = Number((Number(targetUser.balance || 0) + bonusRol).toFixed(2));
    targetUser.refEarn = Number((Number(targetUser.refEarn || 0) + bonusRol).toFixed(2));
    targetUser.spinTickets = Number(targetUser.spinTickets || 0) + addNum;

    for (let i = 0; i < addNum; i++) {
      const slotId = `admin_ref_${Date.now()}_${i}`;
      targetUser.referralsList.push({
        uid: slotId,
        username: `verified_ref_${targetUser.refCount - addNum + i + 1}`,
        firstName: `Verified Miner #${targetUser.refCount - addNum + i + 1}`,
        photoUrl: "",
        verified: true,
        joinedAt: Date.now()
      });
    }

    appendUserHistory(targetUser, 'Admin Verified Referrals', bonusRol, `+${addNum} referrals & +${addNum} spins`);
    saveDB();

    return bot.sendMessage(
      chatId,
      `✅ تمت إضافة <b>${addNum}</b> إحالات موثقة للمستخدم <code>${targetUid}</code>\n` +
      `💰 المكافأة المضافة: <b>+${bonusRol.toLocaleString('en-US')} ROL</b> و <b>+${addNum}</b> لفات سبين\n` +
      `📊 إجمالي إحالاته الموثقة الآن: <b>${targetUser.refCount}</b>`,
      { parse_mode: 'HTML', ...getAdminKeyboard() }
    );
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
