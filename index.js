const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const https = require('https');

const token = process.env.BOT_TOKEN || '9185746835:AAGvEhljsO4swspCFq0jssQezACLXdTsqIU';
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = 1932161126;
const FIREBASE_DB_URL = 'https://rol-mining-default-rtdb.firebaseio.com';
const BASE_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';

let bannedUsers = new Set();
let pendingWithdrawals = [];
let adminAwaitingAction = null; // 'ban' | 'unban' | 'set_balance' | 'broadcast'
let appVersion = Date.now();

function firebaseRequest(path, method = 'GET', bodyData = null) {
  return new Promise((resolve, reject) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${FIREBASE_DB_URL}${cleanPath}`);
    const payload = bodyData !== null ? JSON.stringify(bodyData) : null;

    const options = {
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (payload !== null) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(raw ? JSON.parse(raw) : null);
          } catch (e) {
            resolve(null);
          }
        } else {
          reject(new Error(`Firebase HTTP ${res.statusCode}: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function getAllUsersFromFirebase() {
  const data = await firebaseRequest('/users.json', 'GET');
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data;
  }
  return {};
}

async function resetAllBalancesInFirebase() {
  const nowMs = Date.now();
  appVersion = nowMs;

  // تسجيل طابع التصفير العام ليُجبر index.html على تصفير الكاش والرصيد والجلسة
  await firebaseRequest('/config/global_reset_at.json', 'PUT', nowMs);

  const users = await getAllUsersFromFirebase();
  const uids = Object.keys(users);
  let updatedCount = 0;

  for (const uid of uids) {
    const u = users[uid];
    if (!u || typeof u !== 'object') continue;
    await firebaseRequest(`/users/${uid}.json`, 'PATCH', {
      balance: 0,
      startTime: 0,
      refEarn: 0,
      lastResetAt: nowMs
    });
    updatedCount += 1;
  }

  pendingWithdrawals = [];
  return updatedCount;
}

bot.on('polling_error', (error) => {
  console.log('Polling status:', error.message);
});

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const uidStr = String(userId);
  const firstName = msg.from.first_name || 'صديقي';
  const startParam = (match && match[1] ? match[1].trim() : '');

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 عذراً، لقد تم حظر حسابك من استخدام هذا البوت.');
  }

  try {
    const existing = await firebaseRequest(`/users/${uidStr}.json`, 'GET');
    const patchObj = {
      uid: uidStr,
      username: msg.from.username || '',
      firstName,
      lastSeen: Date.now()
    };
    if (!existing) {
      patchObj.balance = 0;
      patchObj.startTime = 0;
      patchObj.vip = 1;
      patchObj.isVerified = false;
      patchObj.spinTickets = 0;
      patchObj.refCount = 0;
      patchObj.refEarn = 0;
    }
    await firebaseRequest(`/users/${uidStr}.json`, 'PATCH', patchObj);
  } catch (err) {
    console.error('Firebase start sync error:', err.message);
  }

  const querySuffix = startParam ? `startapp=${encodeURIComponent(startParam)}&v=${appVersion}` : `v=${appVersion}`;
  const webAppUrlWithVersion = `${BASE_APP_URL}?${querySuffix}`;

  const welcomeText =
    `⚡ *مرحباً بك يا ${firstName} في ROL Mining*\n\n` +
    `• ابدأ جلسات التعدين (10 ساعات) واجمع عملات *ROL* على شبكة TON.\n` +
    `• ارفع مستوى *VIP* عبر رصيد ROL داخل محفظتك المربوطة واستفد من المكافآت اليومية وعجلة الحظ.\n` +
    `• وثّق حسابك بـ *0.04 GRAM* لاستمرار التعدين وفتح السحب.\n\n` +
    `اضغط على الزر بالأسفل لفتح الواجهة:`;

  const keyboard = [
    [{ text: '🚀 ابدأ تعدين ROL الآن', web_app: { url: webAppUrlWithVersion } }]
  ];

  if (userId === ADMIN_ID) {
    keyboard.push([{ text: '👑 لوحة تحكم المشرف (Admin)', callback_data: 'admin_panel' }]);
  }

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
});

bot.onText(/\/admin/, (msg) => {
  if (msg.from.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ هذا الأمر مخصص لمالك البوت فقط.');
  }
  adminAwaitingAction = null;
  sendAdminPanel(msg.chat.id);
});

async function sendAdminPanel(chatId, messageId = null) {
  let totalUsersCount = 0;
  let totalBalancesSum = 0;
  let verifiedCount = 0;

  try {
    const users = await getAllUsersFromFirebase();
    const list = Object.values(users).filter((u) => u && typeof u === 'object');
    totalUsersCount = list.length;
    totalBalancesSum = list.reduce((acc, u) => acc + (parseFloat(u.balance) || 0), 0);
    verifiedCount = list.filter((u) => Boolean(u.isVerified)).length;
  } catch (err) {
    console.error('Admin stats load error:', err.message);
  }

  const text =
    `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
    `👥 إجمالي المستخدمين: *${totalUsersCount}*\n` +
    `✅ الحسابات الموثقة: *${verifiedCount}*\n` +
    `💰 مجموع الأرصدة في البوت: *${totalBalancesSum.toLocaleString('en-US', { maximumFractionDigits: 2 })} ROL*\n` +
    `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
    `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n\n` +
    `اختر الإجراء المطلوب:`;

  const inline_keyboard = [
    [
      { text: '📥 مراجعة السحوبات', callback_data: 'admin_withdrawals' },
      { text: '🏆 قائمة Top 100', callback_data: 'admin_top100' }
    ],
    [
      { text: '💰 تعديل رصيد مستخدم', callback_data: 'admin_set_balance' },
      { text: '📢 رسالة جماعية', callback_data: 'admin_broadcast' }
    ],
    [
      { text: '🚫 حظر مستخدم', callback_data: 'admin_ban' },
      { text: '✅ إلغاء حظر', callback_data: 'admin_unban' }
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
    });
  }
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;

  if (userId !== ADMIN_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'غير مصرح لك!', show_alert: true });
  }

  if (data === 'admin_panel') {
    adminAwaitingAction = null;
    await sendAdminPanel(chatId, messageId);
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_confirm_reset') {
    const confirmText =
      `⚠️ *تحذير خطير: تصفير جميع الأرصدة*\n\n` +
      `سيتم تصفير أرصدة جميع المستخدمين في قاعدة البيانات وإيقاف جلسات التعدين النشطة فوراً.\n` +
      `هل أنت متأكد من المتابعة؟`;

    const buttons = [
      [{ text: '🔥 نعم، صفّر كل الحسابات الآن', callback_data: 'admin_do_reset' }],
      [{ text: '❌ تراجع', callback_data: 'admin_panel' }]
    ];

    bot.editMessageText(confirmText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_do_reset') {
    try {
      const count = await resetAllBalancesInFirebase();
      bot.answerCallbackQuery(query.id, { text: `تم تصفير ${count} حساب بنجاح! 🧹`, show_alert: true });
      await sendAdminPanel(chatId, messageId);
    } catch (err) {
      console.error('Reset all balances error:', err.message);
      bot.answerCallbackQuery(query.id, { text: 'حدث خطأ أثناء التصفير في Firebase!', show_alert: true });
    }
  }
  else if (data === 'admin_set_balance') {
    adminAwaitingAction = 'set_balance';
    bot.sendMessage(
      chatId,
      'أرسل آيدي المستخدم والرصيد الجديد مفصولين بمسافة:\n`USER_ID NEW_BALANCE`\nمثال: `1932161126 1500`',
      { parse_mode: 'Markdown' }
    );
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_broadcast') {
    adminAwaitingAction = 'broadcast';
    bot.sendMessage(chatId, '📢 أرسل الآن نص الرسالة الجماعية لإرسالها لجميع المستخدمين:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_withdrawals') {
    if (pendingWithdrawals.length === 0) {
      bot.editMessageText('لا توجد طلبات سحب معلقة حالياً.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
        }
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    const req = pendingWithdrawals[0];
    const text =
      `📥 *طلب سحب معلق:*\n\n` +
      `👤 آيدي المستخدم: \`${req.userId}\`\n` +
      `💰 الكمية: *${req.amount} ROL*\n\n` +
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
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('approve_')) {
    const reqId = data.replace('approve_', '');
    pendingWithdrawals = pendingWithdrawals.filter((r) => r.id !== reqId);
    bot.answerCallbackQuery(query.id, { text: 'تمت الموافقة بنجاح! ✅', show_alert: true });
    await sendAdminPanel(chatId, messageId);
  }
  else if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    pendingWithdrawals = pendingWithdrawals.filter((r) => r.id !== reqId);
    bot.answerCallbackQuery(query.id, { text: 'تم الرفض ومصادرة العملات نهائياً! 🚫', show_alert: true });
    await sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_ban') {
    adminAwaitingAction = 'ban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_unban') {
    adminAwaitingAction = 'unban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد فك حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_top100') {
    try {
      const users = await getAllUsersFromFirebase();
      const sorted = Object.values(users)
        .filter((u) => u && typeof u === 'object')
        .sort((a, b) => (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0))
        .slice(0, 15);

      let topText = '🏆 *قائمة المتصدرين (Top 15):*\n\n';
      if (sorted.length === 0) {
        topText += 'لا توجد بيانات مستخدمين حالياً.';
      } else {
        sorted.forEach((u, idx) => {
          const bal = (parseFloat(u.balance) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
          const label = u.username ? `@${u.username}` : `\`${u.uid}\``;
          topText += `${idx + 1}- ${label} — *${bal} ROL*\n`;
        });
      }

      bot.editMessageText(topText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
        }
      });
    } catch (err) {
      bot.editMessageText('❌ تعذر جلب قائمة المتصدرين من قاعدة البيانات.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
        }
      });
    }
    bot.answerCallbackQuery(query.id);
  }
});

bot.on('message', async (msg) => {
  if (msg.from.id !== ADMIN_ID || !msg.text || msg.text.startsWith('/')) return;

  const action = adminAwaitingAction;
  if (!action) return;

  const rawText = msg.text.trim();
  adminAwaitingAction = null;

  if (action === 'ban') {
    const targetId = parseInt(rawText, 10);
    if (isNaN(targetId)) {
      return bot.sendMessage(msg.chat.id, '⚠️ يرجى إرسال رقم ID صحيح.');
    }
    bannedUsers.add(targetId);
    bot.sendMessage(msg.chat.id, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' });
    await sendAdminPanel(msg.chat.id);
  }
  else if (action === 'unban') {
    const targetId = parseInt(rawText, 10);
    if (isNaN(targetId)) {
      return bot.sendMessage(msg.chat.id, '⚠️ يرجى إرسال رقم ID صحيح.');
    }
    bannedUsers.delete(targetId);
    bot.sendMessage(msg.chat.id, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
    await sendAdminPanel(msg.chat.id);
  }
  else if (action === 'set_balance') {
    const parts = rawText.split(/\s+/);
    if (parts.length !== 2) {
      return bot.sendMessage(msg.chat.id, '⚠️ الصيغة الصحيحة: `USER_ID NEW_BALANCE`', { parse_mode: 'Markdown' });
    }
    const targetUid = parts[0];
    const newBal = parseFloat(parts[1]);
    if (!targetUid || isNaN(newBal)) {
      return bot.sendMessage(msg.chat.id, '⚠️ تأكد من صحة المعرف وقيمة الرصيد الرقمية.');
    }
    try {
      await firebaseRequest(`/users/${targetUid}.json`, 'PATCH', {
        balance: newBal,
        updatedAt: Date.now()
      });
      bot.sendMessage(msg.chat.id, `✅ تم تحديث رصيد المستخدم \`${targetUid}\` إلى *${newBal} ROL*`, { parse_mode: 'Markdown' });
      await sendAdminPanel(msg.chat.id);
    } catch (err) {
      bot.sendMessage(msg.chat.id, '❌ فشل تحديث الرصيد في قاعدة البيانات.');
    }
  }
  else if (action === 'broadcast') {
    try {
      const users = await getAllUsersFromFirebase();
      const uids = Object.keys(users);
      let sent = 0;
      for (const uid of uids) {
        try {
          await bot.sendMessage(uid, rawText);
          sent += 1;
          await new Promise((r) => setTimeout(r, 50));
        } catch (e) {}
      }
      bot.sendMessage(msg.chat.id, `📢 تم إرسال الرسالة الجماعية إلى *${sent}* مستخدم.`, { parse_mode: 'Markdown' });
      await sendAdminPanel(msg.chat.id);
    } catch (err) {
      bot.sendMessage(msg.chat.id, '❌ تعذر تنفيذ الإرسال الجماعي.');
    }
  }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is Live and Active.');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
