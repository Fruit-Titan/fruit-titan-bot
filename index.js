const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const url = require('url');

const token = process.env.BOT_TOKEN || '9185746835:AAGvEhljsO4swspCFq0jssQezACLXdTsqIU';
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = 1932161126;
const BASE_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';
const REQUIRED_CHANNEL_USERNAME = 'ROL_TOKN';
const GROUP_INVITE_URL = 'https://t.me/ROL_TOKN_GROUP';

let bannedUsers = new Set();
let pendingWithdrawals = [];
let adminAwaitingAction = null;
let appVersion = Date.now();
let resetVersion = 0;

async function isUserSubscribedToChannel(userId) {
  try {
    const cleanId = Number(userId);
    if (!cleanId || isNaN(cleanId)) return false;
    const member = await bot.getChatMember(`@${REQUIRED_CHANNEL_USERNAME}`, cleanId);
    const allowedStatuses = ['creator', 'administrator', 'member'];
    return Boolean(member && allowedStatuses.includes(member.status));
  } catch (err) {
    console.error('Channel membership check error:', err.message);
    return false;
  }
}

async function notifyAdminOfWithdrawal(reqObj) {
  const wId = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const entry = {
    id: wId,
    userId: String(reqObj.userId || ''),
    username: String(reqObj.username || 'No Username'),
    walletAddress: String(reqObj.walletAddress || ''),
    amount: Number(reqObj.amount || 0),
    createdAt: Date.now()
  };
  pendingWithdrawals.unshift(entry);

  const adminMsg =
    `💸 *طلب سحب جديد (ROL Withdrawal)*\n\n` +
    `👤 اليوزر: *${entry.username}*\n` +
    `🆔 المعرف: \`${entry.userId}\`\n` +
    `🏦 عنوان المحفظة: \`${entry.walletAddress}\`\n` +
    `💰 الكمية: *${entry.amount} ROL*`;

  try {
    await bot.sendMessage(ADMIN_ID, adminMsg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Failed to notify admin of withdrawal:', e.message);
  }
  return entry;
}

bot.on('polling_error', (error) => {
  console.log('Polling status:', error.message);
});

bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'Miner';
  const startParam = match && match[1] ? match[1].trim() : '';

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 Access denied. Your account has been restricted from using this bot.');
  }

  const params = [`v=${appVersion}`];
  if (resetVersion > 0) params.push(`reset=${resetVersion}`);
  if (startParam) params.push(`startapp=${encodeURIComponent(startParam)}`);
  const webAppUrl = `${BASE_APP_URL}?${params.join('&')}`;

  const welcomeText =
    `⚡ *Welcome to ROL Mining, ${firstName}!*\n\n` +
    `*ROL* is a community-driven token built on the *TON* blockchain, designed for active miners, holders, and builders shaping a stronger ecosystem together.\n\n` +
    `✦ *10-Hour Mining Cycles:* Accumulate *ROL* tokens steadily.\n` +
    `✦ *VIP Tiers (VIP 1 – VIP 100):* Free tier starts at 400 ROL/24h (+60 ROL per tier).\n` +
    `✦ *Daily Rewards & Fortune Wheel:* Claim streak bonuses and spin for extra *ROL*.\n` +
    `✦ *Tasks & Referrals:* Complete missions and invite friends to expand the network.\n\n` +
    `Every miner is an early pioneer — let's build and grow the future of *ROL* together.\n\n` +
    `Tap the button below to enter the mining terminal:`;

  const keyboard = [
    [{ text: '🚀 Start Mining ROL Now', web_app: { url: webAppUrl } }],
    [{ text: '💬 Join Community Group', url: GROUP_INVITE_URL }]
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
    return bot.sendMessage(msg.chat.id, '⛔ This command is restricted to the bot administrator.');
  }
  adminAwaitingAction = null;
  sendAdminPanel(msg.chat.id);
});

function sendAdminPanel(chatId, messageId = null) {
  const text =
    `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
    `🔄 رقم إصدار التصفير الحالي: *${resetVersion}*\n` +
    `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
    `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n\n` +
    `اختر الإجراء المطلوب:`;

  const inline_keyboard = [
    [
      { text: '📥 مراجعة السحوبات', callback_data: 'admin_withdrawals' },
      { text: '🏆 قائمة Top 100', callback_data: 'admin_top100' }
    ],
    [
      { text: '📢 رسالة جماعية', callback_data: 'admin_broadcast' },
      { text: '🔄 تحديث اللوحة', callback_data: 'admin_panel' }
    ],
    [
      { text: '🚫 حظر مستخدم', callback_data: 'admin_ban' },
      { text: '✅ إلغاء حظر', callback_data: 'admin_unban' }
    ],
    [
      { text: '⚠️ تصفير جميع الأرصدة (Reset)', callback_data: 'admin_confirm_reset' }
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

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;

  if (userId !== ADMIN_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'غير مصرح لك!', show_alert: true });
  }

  if (data === 'admin_panel') {
    adminAwaitingAction = null;
    sendAdminPanel(chatId, messageId);
    bot.answerCallbackQuery(query.id);
  } else if (data === 'admin_confirm_reset') {
    const confirmText =
      `⚠️ *تحذير خطير: تصفير جميع الأرصدة*\n\n` +
      `سيتم تفعيل أمر التصفير لجميع المستخدمين وإيقاف جلسات التعدين عند فتح التطبيق.\n` +
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
  } else if (data === 'admin_do_reset') {
    resetVersion = Date.now();
    appVersion = resetVersion;
    pendingWithdrawals = [];
    bot.answerCallbackQuery(query.id, { text: 'تم تفعيل تصفير جميع الأرصدة بنجاح! 🧹', show_alert: true });
    sendAdminPanel(chatId, messageId);
  } else if (data === 'admin_broadcast') {
    adminAwaitingAction = 'broadcast';
    bot.sendMessage(chatId, '📢 أرسل الآن نص الرسالة الجماعية لإرسالها:');
    bot.answerCallbackQuery(query.id);
  } else if (data === 'admin_withdrawals') {
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
      `👤 اليوزر: *${req.username}*\n` +
      `🆔 المعرف: \`${req.userId}\`\n` +
      `🏦 العنوان: \`${req.walletAddress}\`\n` +
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
  } else if (data.startsWith('approve_') || data.startsWith('reject_')) {
    const isApprove = data.startsWith('approve_');
    const reqId = data.replace(isApprove ? 'approve_' : 'reject_', '');
    pendingWithdrawals = pendingWithdrawals.filter((r) => r.id !== reqId);
    bot.answerCallbackQuery(query.id, {
      text: isApprove ? 'تمت الموافقة بنجاح! ✅' : 'تم الرفض بنجاح! 🚫',
      show_alert: true
    });
    sendAdminPanel(chatId, messageId);
  } else if (data === 'admin_ban') {
    adminAwaitingAction = 'ban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد حظره:');
    bot.answerCallbackQuery(query.id);
  } else if (data === 'admin_unban') {
    adminAwaitingAction = 'unban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد فك حظره:');
    bot.answerCallbackQuery(query.id);
  } else if (data === 'admin_top100') {
    const topText =
      `🏆 *قائمة المتصدرين:*\n\n` +
      `🥇 1- \`${ADMIN_ID}\` — 0.00 ROL\n` +
      `*(تم تفعيل إصدار التصفير رقم: ${resetVersion || 0})*`;

    bot.editMessageText(topText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
});

bot.on('message', async (msg) => {
  if (msg.web_app_data && msg.web_app_data.data) {
    try {
      const parsed = JSON.parse(msg.web_app_data.data);
      if (parsed && parsed.type === 'withdraw_request') {
        await notifyAdminOfWithdrawal({
          userId: parsed.userId || msg.from.id,
          username: msg.from.username ? `@${msg.from.username}` : (parsed.username || 'No Username'),
          walletAddress: parsed.walletAddress,
          amount: parsed.amount
        });
      }
    } catch (e) {}
    return;
  }

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
    sendAdminPanel(msg.chat.id);
  } else if (action === 'unban') {
    const targetId = parseInt(rawText, 10);
    if (isNaN(targetId)) {
      return bot.sendMessage(msg.chat.id, '⚠️ يرجى إرسال رقم ID صحيح.');
    }
    bannedUsers.delete(targetId);
    bot.sendMessage(msg.chat.id, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
    sendAdminPanel(msg.chat.id);
  } else if (action === 'broadcast') {
    bot.sendMessage(msg.chat.id, `📢 تم تجهيز الرسالة الجماعية:\n\n${rawText}`);
    sendAdminPanel(msg.chat.id);
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

  if (req.method === 'POST' && parsedUrl.pathname === '/api/withdraw') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        await notifyAdminOfWithdrawal(data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is Live and Active.');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
