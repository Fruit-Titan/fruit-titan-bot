const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const crypto = require('crypto');

const token = process.env.BOT_TOKEN || '9185746835:AAGvEhljsO4swspCFq0jssQezACLXdTsqIU';
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = 1932161126;
const BASE_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';

const REQUIRED_CHANNEL_USERNAME = 'ROL_TOKN';
const REQUIRED_CHANNEL_URL = 'https://t.me/ROL_TOKN';
const GROUP_INVITE_URL = 'https://t.me/ROL_TOKN_GROUP';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.createHash('sha256').update(token).digest('hex');

let bannedUsers = new Set();
let pendingWithdrawals = [];
let adminAwaitingAction = null; // 'ban' | 'unban' | 'broadcast'
let appVersion = Date.now();
let resetVersion = 0;

function createJoinProof(userId) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${userId}:${REQUIRED_CHANNEL_USERNAME}:${ts}`)
    .digest('hex')
    .slice(0, 16);
  return `${ts}_${sig}`;
}

async function isUserSubscribedToChannel(userId) {
  try {
    const member = await bot.getChatMember(`@${REQUIRED_CHANNEL_USERNAME}`, userId);
    const allowedStatuses = ['creator', 'administrator', 'member'];
    return Boolean(member && allowedStatuses.includes(member.status));
  } catch (err) {
    console.error('Channel membership check error:', err.message);
    return false;
  }
}

function buildVerifiedAppUrl(userId, startParam = '') {
  const proof = createJoinProof(userId);
  const params = [`v=${appVersion}`, `ch_ok=1`, `uid=${userId}`, `proof=${proof}`];
  if (resetVersion > 0) params.push(`reset=${resetVersion}`);
  if (startParam) params.push(`startapp=${encodeURIComponent(startParam)}`);
  return `${BASE_APP_URL}?${params.join('&')}`;
}

function sendForceJoinScreen(chatId, firstName = 'Miner', startParam = '') {
  const text =
    `🛡️ *ACCESS LOCKED — MANDATORY CHANNEL JOIN*\n\n` +
    `Welcome *${firstName}*! You must join our official channel *@${REQUIRED_CHANNEL_USERNAME}* to unlock *ROL Mining*.\n\n` +
    `1. Tap *Join Channel (@ROL_TOKN)* below.\n` +
    `2. Tap *Verify Subscription* after joining.`;

  const keyboard = [
    [{ text: '📢 Join Channel (@ROL_TOKN)', url: REQUIRED_CHANNEL_URL }],
    [{ text: '✅ Verify Subscription', callback_data: `verify_ch_${encodeURIComponent(startParam || '')}` }]
  ];

  return bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard }
  });
}

function sendMainStartMessage(chatId, userId, firstName, startParam = '') {
  const webAppUrl = buildVerifiedAppUrl(userId, startParam);

  const welcomeText =
    `⚡ *Welcome to ROL Mining, ${firstName}!*\n\n` +
    `*ROL* is a community-driven token built on the *TON* blockchain, designed for active miners, holders, and builders shaping a stronger ecosystem together.\n\n` +
    `✦ *10-Hour Mining Cycles:* Accumulate *ROL* tokens steadily.\n` +
    `✦ *VIP Tiers (VIP 1 – VIP 100):* Grow your tier and boost daily rewards.\n` +
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

  return bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

bot.on('polling_error', (error) => {
  console.log('Polling status:', error.message);
});

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'Miner';
  const startParam = match && match[1] ? match[1].trim() : '';

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 Access denied. Your account has been restricted from using this bot.');
  }

  const joined = await isUserSubscribedToChannel(userId);
  if (!joined) {
    return sendForceJoinScreen(chatId, firstName, startParam);
  }

  return sendMainStartMessage(chatId, userId, firstName, startParam);
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
    `📢 قناة الاشتراك الإجباري: *@${REQUIRED_CHANNEL_USERNAME}*\n` +
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

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;
  const firstName = query.from.first_name || 'Miner';

  if (data.startsWith('verify_ch_')) {
    const encodedParam = data.replace('verify_ch_', '');
    const startParam = encodedParam ? decodeURIComponent(encodedParam) : '';
    const joined = await isUserSubscribedToChannel(userId);

    if (!joined) {
      return bot.answerCallbackQuery(query.id, {
        text: '⚠️ You are not a member of @ROL_TOKN yet. Join first, then tap Verify Subscription.',
        show_alert: true
      });
    }

    bot.answerCallbackQuery(query.id, { text: '✅ Subscription verified! Access unlocked.' });
    bot.deleteMessage(chatId, messageId).catch(() => {});
    return sendMainStartMessage(chatId, userId, firstName, startParam);
  }

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
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Miner';

  if (userId === ADMIN_ID && adminAwaitingAction) {
    const action = adminAwaitingAction;
    const rawText = msg.text.trim();
    adminAwaitingAction = null;

    if (action === 'ban') {
      const targetId = parseInt(rawText, 10);
      if (isNaN(targetId)) {
        return bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم ID صحيح.');
      }
      bannedUsers.add(targetId);
      bot.sendMessage(chatId, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' });
      return sendAdminPanel(chatId);
    } else if (action === 'unban') {
      const targetId = parseInt(rawText, 10);
      if (isNaN(targetId)) {
        return bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم ID صحيح.');
      }
      bannedUsers.delete(targetId);
      bot.sendMessage(chatId, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
      return sendAdminPanel(chatId);
    } else if (action === 'broadcast') {
      bot.sendMessage(chatId, `📢 تم تجهيز الرسالة الجماعية:\n\n${rawText}`);
      return sendAdminPanel(chatId);
    }
  }

  if (bannedUsers.has(userId)) return;

  if (msg.chat && msg.chat.type === 'private') {
    const joined = await isUserSubscribedToChannel(userId);
    if (!joined) {
      return sendForceJoinScreen(chatId, firstName);
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
