const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN || '9185746835:AAFSJXdgMJI_SH-klpoTpowKMzDQocSOqVo';
const BASE_APP_URL = process.env.WEBAPP_URL || 'https://fruit-titan.github.io/fruit-titan-app/';
const BOT_BASE_URL = process.env.BOT_BASE_URL || 'https://fruit-titan-bot.onrender.com';
const REQUIRED_CHANNEL_USERNAME = process.env.REQUIRED_CHANNEL || 'ROL_TOKN';
const ADMIN_ID = 1932161126;
const DATA_FILE = path.join(__dirname, 'rol_bot_data.json');
const CONTEST_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const bot = new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
});

let store = {
  users: {},
  withdrawals: {},
  paidTasks: [],
  topLeaderboard: [],
  contest: {
    startedAt: Date.now(),
    durationMs: CONTEST_DURATION_MS
  },
  system: {
    maintenanceEnabled: false,
    maintenanceMessage: 'نقوم حالياً بتحديث النظام وتحسين الأداء. سنعود للعمل قريباً.',
    allowedTesters: []
  }
};

let adminInputState = null; // 'ban' | 'unban' | 'tester' | 'history'
let appVersion = Date.now();
const avatarCache = new Map();

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const startedAt = Number(parsed.contest?.startedAt || Date.now());
        const durationMs = Number(parsed.contest?.durationMs || CONTEST_DURATION_MS);
        store = {
          users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
          withdrawals: parsed.withdrawals && typeof parsed.withdrawals === 'object' ? parsed.withdrawals : {},
          paidTasks: Array.isArray(parsed.paidTasks) ? parsed.paidTasks : [],
          topLeaderboard: Array.isArray(parsed.topLeaderboard) ? parsed.topLeaderboard : [],
          contest: {
            startedAt: startedAt > 0 ? startedAt : Date.now(),
            durationMs: durationMs > 0 ? durationMs : CONTEST_DURATION_MS
          },
          system: {
            maintenanceEnabled: Boolean(parsed.system?.maintenanceEnabled),
            maintenanceMessage: parsed.system?.maintenanceMessage || store.system.maintenanceMessage,
            allowedTesters: Array.isArray(parsed.system?.allowedTesters) ? parsed.system.allowedTesters.map(String) : []
          }
        };
      }
    }
  } catch (e) {
    console.log('Load store notice:', e.message);
  }
}

function saveStore() {
  try {
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store), 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (e) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(store), 'utf8');
    } catch (err2) {
      console.log('Save store notice:', err2.message);
    }
  }
}

function getContestState() {
  if (!store.contest || !store.contest.startedAt) {
    store.contest = { startedAt: Date.now(), durationMs: CONTEST_DURATION_MS };
    saveStore();
  }
  const now = Date.now();
  const duration = Number(store.contest.durationMs || CONTEST_DURATION_MS);
  let elapsed = now - Number(store.contest.startedAt);
  let changed = false;
  while (elapsed >= duration) {
    store.contest.startedAt = Number(store.contest.startedAt) + duration;
    elapsed = now - Number(store.contest.startedAt);
    changed = true;
  }
  if (changed) saveStore();
  const endsAt = Number(store.contest.startedAt) + duration;
  const remainingMs = Math.max(0, endsAt - now);
  return {
    startedAt: Number(store.contest.startedAt),
    endsAt,
    remainingMs
  };
}

function ensureUserRecord(userId, meta = {}) {
  const key = String(userId);
  if (!key || key === 'guest_miner') return null;
  if (!store.users[key]) {
    store.users[key] = {
      uid: key,
      username: meta.username || '',
      firstName: meta.firstName || 'Miner',
      photoUrl: meta.photoUrl || '',
      balance: 0,
      vip: 1,
      banned: false,
      isVerified: false,
      wallet: '',
      onChainWalletROL: 0,
      refCount: 0,
      refEarn: 0,
      referralsList: [],
      completedTasks: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
  if (!Array.isArray(store.users[key].history)) store.users[key].history = [];
  if (!Array.isArray(store.users[key].referralsList)) store.users[key].referralsList = [];
  return store.users[key];
}

function addUserHistory(userId, source, amount, details = '', balanceAfter = null) {
  const key = String(userId);
  const u = ensureUserRecord(key);
  if (!u) return;
  const numAmount = Number(amount || 0);
  u.history.push({
    source: String(source || 'عملية'),
    amount: numAmount,
    details: String(details || ''),
    balanceAfter: balanceAfter !== null ? Number(balanceAfter) : Number(u.balance || 0),
    timestamp: Date.now()
  });
  if (u.history.length > 100) {
    u.history = u.history.slice(-100);
  }
  u.updatedAt = Date.now();
  saveStore();
}

function registerReferralLink(referrerId, invitedId, invitedMeta = {}) {
  const refKey = String(referrerId || '').trim();
  const invKey = String(invitedId || '').trim();
  if (!refKey || !invKey || refKey === invKey || refKey === 'guest_miner' || invKey === 'guest_miner') return;

  const invUser = ensureUserRecord(invKey, invitedMeta);
  if (invUser && !invUser.referredBy) {
    invUser.referredBy = refKey;
  }

  const refUser = ensureUserRecord(refKey);
  if (!refUser) return;

  const existingIdx = refUser.referralsList.findIndex(item => String(item.uid) === invKey);
  const entry = {
    uid: invKey,
    username: invitedMeta.username || invUser?.username || '',
    firstName: invitedMeta.firstName || invUser?.firstName || 'User',
    photoUrl: invitedMeta.photoUrl || invUser?.photoUrl || '',
    verified: Boolean(invUser?.isVerified),
    rewardGranted: existingIdx >= 0 ? Boolean(refUser.referralsList[existingIdx].rewardGranted) : false,
    joinedAt: existingIdx >= 0 ? Number(refUser.referralsList[existingIdx].joinedAt || Date.now()) : Date.now()
  };

  if (existingIdx >= 0) {
    refUser.referralsList[existingIdx] = {
      ...refUser.referralsList[existingIdx],
      ...entry
    };
  } else {
    refUser.referralsList.push(entry);
  }
  syncTopLeaderboardPersistent();
  saveStore();
}

function confirmReferralForReferrer(referrerId, invitedId, invitedMeta = {}) {
  const refKey = String(referrerId || '').trim();
  const invKey = String(invitedId || '').trim();
  if (!refKey || !invKey || refKey === invKey || refKey === 'guest_miner' || invKey === 'guest_miner') return false;

  registerReferralLink(refKey, invKey, { ...invitedMeta, verified: true });
  const refUser = ensureUserRecord(refKey);
  if (!refUser) return false;

  const idx = refUser.referralsList.findIndex(item => String(item.uid) === invKey);
  if (idx >= 0) {
    refUser.referralsList[idx].verified = true;
    refUser.referralsList[idx].verifiedAt = Date.now();
    if (invitedMeta.username) refUser.referralsList[idx].username = invitedMeta.username;
    if (invitedMeta.firstName) refUser.referralsList[idx].firstName = invitedMeta.firstName;
    if (invitedMeta.photoUrl) refUser.referralsList[idx].photoUrl = invitedMeta.photoUrl;

    if (!refUser.referralsList[idx].rewardGranted) {
      refUser.referralsList[idx].rewardGranted = true;
      refUser.refCount = Number(refUser.refCount || 0) + 1;
      refUser.refEarn = Number((Number(refUser.refEarn || 0) + 60).toFixed(2));
      refUser.balance = Number((Number(refUser.balance || 0) + 60).toFixed(2));
      refUser.spinTickets = Number(refUser.spinTickets || 0) + 1;
      addUserHistory(refKey, 'Verified Referral', 60, `From user ${invKey}`, refUser.balance);
    }
  }
  syncTopLeaderboardPersistent();
  saveStore();
  return true;
}

async function getTelegramUserPhotoUrl(userId) {
  try {
    const cleanId = Number(userId);
    if (!cleanId || Number.isNaN(cleanId)) return '';
    const photos = await bot.getUserProfilePhotos(cleanId, { limit: 1 });
    const firstPhoto = photos?.photos?.[0];
    if (!firstPhoto || !firstPhoto.length) return '';
    const bestSize = firstPhoto[firstPhoto.length - 1];
    return await bot.getFileLink(bestSize.file_id);
  } catch (e) {
    return '';
  }
}

function downloadBufferFromUrl(fileUrl) {
  return new Promise((resolve, reject) => {
    https.get(fileUrl, (resp) => {
      if (resp.statusCode && resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return downloadBufferFromUrl(resp.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      const contentType = resp.headers['content-type'] || 'image/jpeg';
      resp.on('data', d => chunks.push(d));
      resp.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
      resp.on('error', reject);
    }).on('error', reject);
  });
}

async function serveUserAvatarImage(userId, res) {
  const key = String(userId || '').trim();
  if (!key || key === 'guest_miner') {
    res.writeHead(404);
    return res.end();
  }

  const cached = avatarCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.writeHead(200, {
      'Content-Type': cached.contentType,
      'Cache-Control': 'public, max-age=1800'
    });
    return res.end(cached.buffer);
  }

  try {
    const fileUrl = await getTelegramUserPhotoUrl(key);
    if (!fileUrl) {
      res.writeHead(404);
      return res.end();
    }
    const { buffer, contentType } = await downloadBufferFromUrl(fileUrl);
    if (!buffer || !buffer.length) {
      res.writeHead(404);
      return res.end();
    }
    avatarCache.set(key, {
      buffer,
      contentType,
      expiresAt: Date.now() + (30 * 60 * 1000)
    });
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=1800'
    });
    res.end(buffer);
  } catch (e) {
    res.writeHead(404);
    res.end();
  }
}

async function isUserSubscribedToChannel(userId) {
  try {
    const cleanId = Number(userId);
    if (!cleanId || Number.isNaN(cleanId)) return false;
    const member = await bot.getChatMember(`@${REQUIRED_CHANNEL_USERNAME}`, cleanId);
    const allowedStatuses = ['creator', 'administrator', 'member'];
    return Boolean(member && allowedStatuses.includes(member.status));
  } catch (err) {
    console.log('Channel membership check error:', err.message);
    return false;
  }
}

function getRealUsersList() {
  return Object.entries(store.users || {})
    .filter(([k, u]) => u && typeof u === 'object' && k !== 'guest_miner');
}

function syncTopLeaderboardPersistent() {
  const realUsers = getRealUsersList();
  const verifiedByReferrer = new Map();

  for (const [invId, invUser] of realUsers) {
    if (invUser && invUser.isVerified && invUser.referredBy) {
      const refId = String(invUser.referredBy).trim();
      if (refId && refId !== String(invId)) {
        if (!verifiedByReferrer.has(refId)) verifiedByReferrer.set(refId, new Set());
        verifiedByReferrer.get(refId).add(String(invId));
      }
    }
  }

  const mapByUid = new Map();
  for (const prev of (Array.isArray(store.topLeaderboard) ? store.topLeaderboard : [])) {
    if (prev && prev.uid) {
      mapByUid.set(String(prev.uid), {
        uid: String(prev.uid),
        firstName: prev.firstName || 'Miner',
        username: prev.username || '',
        photoUrl: `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(String(prev.uid))}`,
        verifiedReferrals: Number(prev.verifiedReferrals || 0)
      });
    }
  }

  for (const [uId, u] of realUsers) {
    if (!u || u.banned) continue;
    const refSet = verifiedByReferrer.get(String(uId)) || new Set();
    if (Array.isArray(u.referralsList)) {
      for (const r of u.referralsList) {
        if (r && r.verified && r.uid) refSet.add(String(r.uid));
      }
    }
    const historyVerifiedCount = Array.isArray(u.history)
      ? u.history.filter(h => h && String(h.source || '').toLowerCase().includes('verified referral')).length
      : 0;
    const computedCount = Math.max(Number(u.refCount || 0), refSet.size, historyVerifiedCount);
    const existingEntry = mapByUid.get(String(uId));
    const finalCount = Math.max(computedCount, Number(existingEntry?.verifiedReferrals || 0));

    mapByUid.set(String(uId), {
      uid: String(uId),
      firstName: u.firstName || existingEntry?.firstName || 'Miner',
      username: u.username || existingEntry?.username || '',
      photoUrl: `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(String(uId))}`,
      verifiedReferrals: finalCount
    });
  }

  const sorted = Array.from(mapByUid.values())
    .sort((a, b) => Number(b.verifiedReferrals || 0) - Number(a.verifiedReferrals || 0));

  let slotIndex = 1;
  while (sorted.length < 20) {
    const slotUid = `slot_${slotIndex}`;
    if (!sorted.some(x => String(x.uid) === slotUid)) {
      sorted.push({
        uid: slotUid,
        firstName: `Miner #${slotIndex}`,
        username: '',
        photoUrl: '',
        verifiedReferrals: 0
      });
    }
    slotIndex++;
  }

  store.topLeaderboard = sorted.slice(0, 20);
  return store.topLeaderboard;
}

function getTop20VerifiedReferrers() {
  return syncTopLeaderboardPersistent();
}

function getBannedSet() {
  return new Set(
    getRealUsersList()
      .filter(([, u]) => Boolean(u.banned))
      .map(([uid]) => Number(uid))
      .filter(n => !Number.isNaN(n))
  );
}

function getPendingWithdrawalsList() {
  return Object.entries(store.withdrawals || {})
    .filter(([, w]) => w && w.status === 'pending')
    .map(([id, w]) => ({ id, ...w }));
}

function resetAllBalancesLocal() {
  const list = getRealUsersList();
  let resetCount = 0;
  for (const [uidKey, uVal] of list) {
    store.users[uidKey] = {
      ...uVal,
      balance: 0,
      startTime: 0,
      resetAt: Date.now()
    };
    addUserHistory(uidKey, 'Admin Reset', 0, 'Balance reset by admin', 0);
    resetCount++;
  }
  saveStore();
  return resetCount;
}

loadStore();
getContestState();
syncTopLeaderboardPersistent();

bot.on('polling_error', (err) => {
  console.log('Polling error:', err.message);
});

bot.on('webhook_error', (err) => {
  console.log('Webhook error:', err.message);
});

bot.onText(/\/start(.*)/, (msg, match) => {
  if (!msg || !msg.from) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'Miner';
  const rawPayload = match && match[1] ? match[1].trim() : '';
  const startParam = rawPayload.split(/\s+/)[0] || '';

  const bannedUsers = getBannedSet();
  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 Sorry, your account has been banned from using this bot.').catch(() => {});
  }

  const uidStr = String(userId);
  const avatarEndpoint = `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(uidStr)}`;
  const existedBefore = Boolean(store.users[uidStr]);
  const userRec = ensureUserRecord(uidStr, {
    username: msg.from.username || '',
    firstName,
    photoUrl: avatarEndpoint
  });

  if (userRec) {
    userRec.username = msg.from.username || userRec.username || '';
    userRec.firstName = firstName;
    userRec.photoUrl = avatarEndpoint;
    userRec.updatedAt = Date.now();
  }

  if (startParam && startParam.startsWith('ref_')) {
    const refId = startParam.replace('ref_', '').trim();
    if (refId && refId !== uidStr) {
      if (!userRec.referredBy) {
        userRec.referredBy = refId;
      }
      registerReferralLink(refId, uidStr, {
        username: msg.from.username || '',
        firstName,
        photoUrl: avatarEndpoint
      });
    }
  }

  if (!existedBefore) {
    addUserHistory(uidStr, 'Account Created', 0, 'Joined via /start', 0);
  } else {
    syncTopLeaderboardPersistent();
    saveStore();
  }

  const maintParam = store.system.maintenanceEnabled ? '&maint=1' : '';
  const refQuery = startParam ? `&tgWebAppStartParam=${encodeURIComponent(startParam)}` : '';
  const webAppUrlWithVersion = `${BASE_APP_URL}?v=${appVersion}${maintParam}${refQuery}`;
  const welcomeText = `Welcome ${firstName} to the official ROL Mining app!\n\nTap the button below to launch the mini app and start mining:`;
  const keyboard = [
    [{ text: '🚀 Start ROL Mining Now', web_app: { url: webAppUrlWithVersion } }]
  ];

  if (userId === ADMIN_ID) {
    keyboard.push([{ text: '👑 لوحة تحكم المشرف (Admin)', callback_data: 'admin_panel' }]);
  }

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  }).catch((e) => console.log('sendMessage /start err:', e.message));
});

bot.onText(/\/admin/, (msg) => {
  if (!msg || !msg.from) return;
  if (msg.from.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ هذا الأمر مخصص لمالك البوت فقط.').catch(() => {});
  }
  sendAdminPanel(msg.chat.id);
});

function sendAdminPanel(chatId, messageId = null) {
  const realUsers = getRealUsersList();
  const totalUsersCount = realUsers.length;
  const activeHoldersCount = realUsers.filter(([, u]) => Number(u.balance || 0) > 0).length;
  const bannedUsers = getBannedSet();
  const pendingWithdrawals = getPendingWithdrawalsList();
  const maintBadge = store.system.maintenanceEnabled ? 'مفعّل في التطبيق 🔴' : 'متوقف 🟢';

  const text = `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
               `👥 إجمالي المستخدمين الحقيقيين: *${totalUsersCount}*\n` +
               `💰 حاملو العملة داخل البوت (>0): *${activeHoldersCount}*\n` +
               `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
               `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n` +
               `🛠️ صيانة التطبيق: *${maintBadge}*\n` +
               `🧪 المختبرون المسموح لهم: *${store.system.allowedTesters.length}*\n\n` +
               `اختر الإجراء المطلوب:`;

  const inline_keyboard = [
    [
      { text: '📥 مراجعة السحوبات', callback_data: 'admin_withdrawals' },
      { text: '🏆 Top 100 حاملي العملة', callback_data: 'admin_top100' }
    ],
    [
      { text: '📜 سجل مستخدم (History)', callback_data: 'admin_user_history' },
      { text: '👥 إحصائيات المستخدمين', callback_data: 'admin_real_users' }
    ],
    [
      { text: '📋 المهام (الحالية والسابقة)', callback_data: 'admin_tasks_report' },
      { text: '🚫 حظر مستخدم', callback_data: 'admin_ban' }
    ],
    [
      { text: '✅ إلغاء حظر', callback_data: 'admin_unban' },
      { text: '🧪 إضافة مختبر', callback_data: 'admin_add_tester' }
    ],
    [
      {
        text: store.system.maintenanceEnabled ? '🟢 إيقاف صيانة التطبيق' : '🔴 تفعيل صيانة التطبيق',
        callback_data: 'admin_toggle_maintenance'
      },
      { text: '💾 نسخة احتياطية للبيانات', callback_data: 'admin_backup' }
    ],
    [
      { text: '⚠️ تصفير جميع الأرصدة (Reset)', callback_data: 'admin_confirm_reset' }
    ],
    [
      { text: '🔄 تحديث الإحصائيات', callback_data: 'admin_panel' }
    ]
  ];

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    }).catch(() => {});
  }
}

bot.on('callback_query', (query) => {
  if (!query || !query.message || !query.from) return;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;

  if (userId !== ADMIN_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'غير مصرح لك!', show_alert: true }).catch(() => {});
  }

  if (data === 'admin_panel') {
    sendAdminPanel(chatId, messageId);
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_backup') {
    saveStore();
    if (fs.existsSync(DATA_FILE)) {
      bot.sendDocument(chatId, fs.createReadStream(DATA_FILE), {
        caption: '💾 نسخة احتياطية لبيانات البوت والمستخدمين والمهام'
      }, { filename: 'rol_bot_data.json' }).catch(() => {});
    }
    bot.answerCallbackQuery(query.id, { text: 'تم إرسال النسخة الاحتياطية 💾', show_alert: true }).catch(() => {});
  }
  else if (data === 'admin_tasks_report') {
    const tasksList = Array.isArray(store.paidTasks) ? store.paidTasks : [];
    let report = `📋 *تقرير المهام (الحالية والسابقة):*\n\n`;

    if (tasksList.length === 0) {
      report += `_لا توجد مهام مضافة حتى الآن._`;
    } else {
      tasksList.slice().reverse().slice(0, 30).forEach((tItem, idx) => {
        const doneCnt = Number(tItem.completedCount || 0);
        const targetCnt = Number(tItem.targetUsers || 0);
        const isFinished = doneCnt >= targetCnt;
        const statusLabel = isFinished ? 'منتهية ✅' : 'نشطة 🟢';
        report += `${idx + 1}. *${tItem.label || tItem.url}* — *${statusLabel}*\n` +
                  `   👥 المنفّذون: *${doneCnt}* / *${targetCnt}* | 💎 المكافأة: *${tItem.rewardRol || 10} ROL*\n` +
                  `   🔗 \`${tItem.url || '-'}\`\n`;
      });
    }

    if (report.length > 3900) {
      report = report.slice(0, 3850) + '\n...';
    }

    bot.editMessageText(report, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_toggle_maintenance') {
    store.system.maintenanceEnabled = !store.system.maintenanceEnabled;
    saveStore();
    bot.answerCallbackQuery(query.id, {
      text: store.system.maintenanceEnabled ? 'تم تفعيل وضع الصيانة في التطبيق 🔴' : 'تم إيقاف وضع الصيانة 🟢',
      show_alert: true
    }).catch(() => {});
    sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_add_tester') {
    adminInputState = 'tester';
    bot.sendMessage(chatId, 'أرسل الآن Telegram ID الخاص بالمختبر للسماح له بدخول التطبيق أثناء الصيانة:').catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_confirm_reset') {
    const confirmText = `⚠️ *تحذير خطير: تصفير الأرصدة*\n\n` +
                        `هل أنت متأكد من رغبتك في تصفير جميع أرصدة وتعدين المستخدمين وإعادتهم إلى الصفر؟`;
    const buttons = [
      [{ text: '🔥 نعم، صفّر كل الحسابات الآن', callback_data: 'admin_do_reset' }],
      [{ text: '❌ تراجع', callback_data: 'admin_panel' }]
    ];
    bot.editMessageText(confirmText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_do_reset') {
    const resetCount = resetAllBalancesLocal();
    appVersion = Date.now();
    bot.answerCallbackQuery(query.id, {
      text: `تم تصفير ${resetCount} حساب بنجاح! 🧹`,
      show_alert: true
    }).catch(() => {});
    sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_withdrawals') {
    const pendingWithdrawals = getPendingWithdrawalsList();
    if (pendingWithdrawals.length === 0) {
      bot.editMessageText('لا توجد طلبات سحب معلقة حالياً.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
        }
      }).catch(() => {});
      return bot.answerCallbackQuery(query.id).catch(() => {});
    }

    const req = pendingWithdrawals[0];
    const reqUid = req.uid || req.userId || '-';
    const text = `📥 *طلب سحب معلق:*\n\n` +
                 `👤 آيدي المستخدم: \`${reqUid}\`\n` +
                 `💰 الكمية: *${req.amount || 0} ROL*\n` +
                 `💸 الرسوم (5%): *${req.feeAmount || 0} ROL* | الصافي: *${req.netAmount || req.amount || 0} ROL*\n` +
                 `🏦 المحفظة: \`${req.address || '-'}\`\n\n` +
                 `اختر الإجراء:`;

    const buttons = [
      [
        { text: '✅ موافقة', callback_data: `approve_${req.id}` },
        { text: '❌ رفض ومصادرة', callback_data: `reject_${req.id}` }
      ],
      [{ text: '🔙 رجوع', callback_data: 'admin_panel' }]
    ];

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data.startsWith('approve_')) {
    const reqId = data.replace('approve_', '');
    if (store.withdrawals[reqId]) {
      store.withdrawals[reqId].status = 'approved';
      store.withdrawals[reqId].reviewedAt = Date.now();
      saveStore();
    }
    bot.answerCallbackQuery(query.id, { text: 'تمت الموافقة بنجاح! ✅', show_alert: true }).catch(() => {});
    sendAdminPanel(chatId, messageId);
  }
  else if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    if (store.withdrawals[reqId]) {
      store.withdrawals[reqId].status = 'rejected';
      store.withdrawals[reqId].reviewedAt = Date.now();
      saveStore();
    }
    bot.answerCallbackQuery(query.id, { text: 'تم الرفض ومصادرة العملات نهائياً! 🚫', show_alert: true }).catch(() => {});
    sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_ban') {
    adminInputState = 'ban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد حظره:').catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_unban') {
    adminInputState = 'unban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد فك حظره:').catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_real_users') {
    const valid = getRealUsersList();
    const totalSupplyInBot = valid.reduce((sum, [, u]) => sum + Number(u.balance || 0), 0);
    const verifiedCount = valid.filter(([, u]) => Boolean(u.isVerified)).length;
    const walletLinkedCount = valid.filter(([, u]) => Boolean(u.wallet)).length;

    const statsMsg = `👥 *إحصائيات المستخدمين الحقيقية:*\n\n` +
                     `• إجمالي الحسابات المسجلة: *${valid.length}*\n` +
                     `• حاملو رصيد ROL (> 0): *${valid.filter(([, u]) => Number(u.balance || 0) > 0).length}*\n` +
                     `• الحسابات الموثّقة (0.05 GRAM): *${verifiedCount}*\n` +
                     `• المحافظ المربوطة: *${walletLinkedCount}*\n` +
                     `• إجمالي أرصدة ROL داخل البوت: *${Number(totalSupplyInBot.toFixed(2))} ROL*`;

    bot.editMessageText(statsMsg, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_user_history') {
    adminInputState = 'history';
    bot.sendMessage(chatId, '📜 أرسل الآن *Telegram ID* الخاص بالمستخدم لعرض سجل جمع عملاته بالتفصيل (History):', {
      parse_mode: 'Markdown'
    }).catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
  else if (data === 'admin_top100') {
    let topText = `🏆 *أكبر 100 حامل لعملة ROL داخل البوت:*\n\n`;
    const list = getRealUsersList()
      .filter(([, u]) => Number(u.balance || 0) > 0)
      .map(([uId, u]) => ({
        uid: uId,
        username: u.username || '',
        balance: Number(u.balance || 0),
        verified: u.isVerified ? '✅' : '⏳'
      }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 100);

    if (list.length === 0) {
      topText += `لا يوجد حاملو عملة برصيد أكبر من 0 حالياً.`;
    } else {
      list.forEach((item, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
        const nameLabel = item.username ? `@${item.username} (\`${item.uid}\`)` : `\`${item.uid}\``;
        topText += `${medal} ${nameLabel} ${item.verified} — *${item.balance}* ROL\n`;
      });
    }

    if (topText.length > 3900) {
      topText = topText.slice(0, 3850) + '\n...';
    }

    bot.editMessageText(topText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
});

bot.on('message', (msg) => {
  if (!msg.from || msg.from.id !== ADMIN_ID || !msg.text || msg.text.startsWith('/')) return;
  if (!adminInputState) return;

  const chatId = msg.chat.id;
  const targetId = parseInt(msg.text.trim(), 10);
  if (isNaN(targetId)) {
    return bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم ID صحيح.').catch(() => {});
  }

  const currentAction = adminInputState;
  adminInputState = null;
  const strId = String(targetId);

  if (currentAction === 'ban') {
    const u = ensureUserRecord(strId);
    if (u) {
      u.banned = true;
      u.bannedAt = Date.now();
      saveStore();
    }
    bot.sendMessage(chatId, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' }).catch(() => {});
    sendAdminPanel(chatId);
  } else if (currentAction === 'unban') {
    if (store.users[strId]) {
      store.users[strId].banned = false;
      saveStore();
    }
    bot.sendMessage(chatId, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' }).catch(() => {});
    sendAdminPanel(chatId);
  } else if (currentAction === 'tester') {
    if (!store.system.allowedTesters.includes(strId)) {
      store.system.allowedTesters.push(strId);
      saveStore();
    }
    bot.sendMessage(chatId, `🧪 تم إضافة المختبر بنجاح: \`${strId}\``, { parse_mode: 'Markdown' }).catch(() => {});
    sendAdminPanel(chatId);
  } else if (currentAction === 'history') {
    const userData = store.users[strId];
    if (!userData || typeof userData !== 'object') {
      bot.sendMessage(chatId, `⚠️ لم يتم العثور على مستخدم بالمعرف \`${strId}\`.`, { parse_mode: 'Markdown' }).catch(() => {});
      return sendAdminPanel(chatId);
    }

    const uname = userData.username ? `@${userData.username}` : 'بدون يوزر';
    const bal = Number(userData.balance || 0);
    const onChain = Number(userData.onChainWalletROL || 0);
    const refs = Number(userData.refCount || 0);
    const refEarn = Number(userData.refEarn || 0);
    const verifiedTxt = userData.isVerified ? 'موثّق ✅' : 'غير موثّق ❌';
    const walletTxt = userData.wallet ? `\`${userData.wallet}\`` : 'غير مربوطة';
    const tasksDone = Array.isArray(userData.completedTasks) ? userData.completedTasks.length : 0;

    let report = `📜 *سجل المستخدم (User History):*\n\n` +
                 `👤 المعرف: \`${strId}\` (${uname})\n` +
                 `💰 الرصيد الحالي في البوت: *${bal} ROL*\n` +
                 `💎 رصيد المحفظة على الشبكة: *${onChain} ROL*\n` +
                 `🛡️ حالة التوثيق: *${verifiedTxt}*\n` +
                 `🏦 المحفظة: ${walletTxt}\n` +
                 `👥 الإحالات المؤكدة: *${refs}* (أرباحها: *${refEarn} ROL*)\n` +
                 `✅ المهام المكتملة: *${tasksDone}*\n\n` +
                 `📊 *آخر العمليات ومصادر جمع العملات:*\n`;

    const entries = Array.isArray(userData.history)
      ? [...userData.history].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 25)
      : [];

    if (entries.length === 0) {
      report += `_لا توجد حركات مسجلة في السجل التفصيلي بعد._`;
    } else {
      entries.forEach((ev, idx) => {
        const dt = ev.timestamp ? new Date(ev.timestamp).toISOString().replace('T', ' ').slice(0, 16) : '-';
        const sign = Number(ev.amount || 0) >= 0 ? '+' : '';
        const det = ev.details ? ` (${ev.details})` : '';
        report += `${idx + 1}. *${ev.source || 'عملية'}*: *${sign}${ev.amount} ROL*${det}\n   🕒 ${dt} UTC\n`;
      });
    }

    if (report.length > 3950) {
      report = report.slice(0, 3900) + '\n...';
    }

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' })
      .catch(() => {})
      .finally(() => sendAdminPanel(chatId));
  }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'GET' && parsedUrl.pathname === '/api/avatar') {
    const targetUid = parsedUrl.query?.uid || '';
    serveUserAvatarImage(targetUid, res);
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/top-referrals') {
    const contest = getContestState();
    const top20 = getTop20VerifiedReferrers();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      top20,
      contest,
      prizes: [
        { rank: 1, reward: '10 GRAM' },
        { rank: 2, reward: '5 GRAM' },
        { rank: 3, reward: '3 GRAM' },
        { rank: 4, reward: '1 GRAM' },
        { rank: 5, reward: '1 GRAM' }
      ]
    }));
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/check-channel') {
    const targetUserId = parsedUrl.query?.userId || '';
    isUserSubscribedToChannel(targetUserId)
      .then((joined) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, joined: Boolean(joined) }));
      })
      .catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, joined: false }));
      });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/tasks') {
    const activeTasks = (store.paidTasks || []).filter(
      t => Number(t.completedCount || 0) < Number(t.targetUsers || 0)
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, tasks: activeTasks }));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tasks') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const tData = JSON.parse(body || '{}');
        const targetUsers = parseInt(tData.targetUsers || '0', 10);
        if (!tData.url || isNaN(targetUsers) || targetUsers < 50) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'Invalid task data' }));
        }
        const taskId = String(tData.id || `ctask_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
        const existingIdx = (store.paidTasks || []).findIndex(item => String(item.id) === taskId);
        const taskObj = {
          id: taskId,
          url: String(tData.url),
          label: String(tData.label || tData.url),
          targetUsers: targetUsers,
          completedCount: existingIdx >= 0 ? Number(store.paidTasks[existingIdx].completedCount || 0) : 0,
          completedBy: existingIdx >= 0 && Array.isArray(store.paidTasks[existingIdx].completedBy) ? store.paidTasks[existingIdx].completedBy : [],
          rewardRol: 10,
          paidGram: Number(tData.paidGram || ((targetUsers / 50) * 1).toFixed(4)),
          createdBy: String(tData.createdBy || ''),
          createdAt: existingIdx >= 0 ? Number(store.paidTasks[existingIdx].createdAt || Date.now()) : Date.now()
        };
        if (existingIdx >= 0) {
          store.paidTasks[existingIdx] = taskObj;
        } else {
          store.paidTasks.unshift(taskObj);
        }
        saveStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, task: taskObj }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tasks/complete') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const taskId = String(payload.taskId || '').trim();
        const uId = String(payload.uid || '').trim();
        let idx = (store.paidTasks || []).findIndex(t => String(t.id) === taskId);

        if (idx === -1 && payload.taskMeta && payload.taskMeta.url) {
          const metaUsers = parseInt(payload.taskMeta.targetUsers || '50', 10);
          store.paidTasks.unshift({
            id: taskId || `ctask_${Date.now()}`,
            url: String(payload.taskMeta.url),
            label: String(payload.taskMeta.label || payload.taskMeta.url),
            targetUsers: isNaN(metaUsers) ? 50 : metaUsers,
            completedCount: 0,
            completedBy: [],
            rewardRol: 10,
            paidGram: Number(payload.taskMeta.paidGram || 1),
            createdBy: String(payload.taskMeta.createdBy || ''),
            createdAt: Number(payload.taskMeta.createdAt || Date.now())
          });
          idx = 0;
        }

        if (idx === -1) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, expired: true }));
        }

        const taskObj = store.paidTasks[idx];
        if (!Array.isArray(taskObj.completedBy)) taskObj.completedBy = [];
        if (uId && uId !== 'guest_miner' && taskObj.completedBy.includes(uId)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, alreadyCompleted: true }));
        }

        if (Number(taskObj.completedCount || 0) >= Number(taskObj.targetUsers || 0)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, expired: true }));
        }

        if (uId && uId !== 'guest_miner') {
          taskObj.completedBy.push(uId);
        }
        taskObj.completedCount = Number(taskObj.completedCount || 0) + 1;
        saveStore();

        const stillActive = taskObj.completedCount < Number(taskObj.targetUsers || 0);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, rewardRol: 10, stillActive }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/referral/track') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const referrerId = String(payload.referrerId || '').trim();
        const invitedId = String(payload.invitedId || '').trim();
        const avatarEndpoint = `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(invitedId)}`;
        registerReferralLink(referrerId, invitedId, {
          username: payload.username || '',
          firstName: payload.firstName || 'User',
          photoUrl: avatarEndpoint
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/referral/confirm') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const referrerId = String(payload.referrerId || '').trim();
        const invitedId = String(payload.invitedId || '').trim();
        const avatarEndpoint = `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(invitedId)}`;
        const confirmed = confirmReferralForReferrer(referrerId, invitedId, {
          username: payload.username || '',
          firstName: payload.firstName || 'User',
          photoUrl: avatarEndpoint
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: confirmed }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/user') {
    const uId = String(parsedUrl.query?.uid || '').trim();
    const userObj = uId && store.users[uId] ? store.users[uId] : null;
    if (userObj && Array.isArray(userObj.referralsList)) {
      userObj.referralsList = userObj.referralsList.map(item => {
        const inv = store.users[String(item.uid)];
        const invAvatar = `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(String(item.uid))}`;
        return {
          ...item,
          username: inv?.username || item.username || '',
          firstName: inv?.firstName || item.firstName || 'User',
          photoUrl: invAvatar,
          verified: Boolean(inv?.isVerified || item.verified)
        };
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      user: userObj,
      system: store.system,
      contest: getContestState(),
      appVersion
    }));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/sync-user') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const uId = String(payload.uid || '').trim();
        if (!uId || uId === 'guest_miner') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true }));
        }
        const existing = ensureUserRecord(uId, payload);
        const avatarEndpoint = `${BOT_BASE_URL}/api/avatar?uid=${encodeURIComponent(uId)}`;
        store.users[uId] = {
          ...existing,
          ...payload,
          uid: uId,
          photoUrl: avatarEndpoint,
          history: Array.isArray(existing.history) ? existing.history : [],
          referralsList: Array.isArray(existing.referralsList) ? existing.referralsList : [],
          updatedAt: Date.now()
        };

        const refBy = store.users[uId].referredBy;
        if (refBy && refBy !== uId) {
          registerReferralLink(refBy, uId, {
            username: store.users[uId].username,
            firstName: store.users[uId].firstName,
            photoUrl: store.users[uId].photoUrl
          });
          if (store.users[uId].isVerified) {
            confirmReferralForReferrer(refBy, uId, {
              username: store.users[uId].username,
              firstName: store.users[uId].firstName,
              photoUrl: store.users[uId].photoUrl
            });
          }
        }

        if (payload.historyEntry && typeof payload.historyEntry === 'object') {
          store.users[uId].history.push({
            ...payload.historyEntry,
            timestamp: payload.historyEntry.timestamp || Date.now()
          });
          if (store.users[uId].history.length > 100) {
            store.users[uId].history = store.users[uId].history.slice(-100);
          }
        }
        syncTopLeaderboardPersistent();
        saveStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/withdraw') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const wData = JSON.parse(body || '{}');
        const reqId = String(wData.id || `wd_${Date.now()}`);
        store.withdrawals[reqId] = {
          ...wData,
          id: reqId,
          status: 'pending',
          createdAt: wData.createdAt || Date.now()
        };
        if (wData.uid) {
          addUserHistory(wData.uid, 'Withdrawal Request', -Number(wData.amount || 0), `Net: ${wData.netAmount || 0} ROL`, 0);
        }
        saveStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is Live and Active.');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
