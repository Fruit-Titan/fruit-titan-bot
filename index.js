const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const token = process.env.BOT_TOKEN || '9185746835:AAGvEhljsO4swspCFq0jssQezACLXdTsqIU';
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = 1932161126;
const BASE_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';

let bannedUsers = new Set();
let pendingWithdrawals = [];
let adminAwaitingAction = null; // 'ban' | 'unban' | 'broadcast'
let appVersion = Date.now();
let resetVersion = 0;

bot.on('polling_error', (error) => {
  console.log('Polling status:', error.message);
});

bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'صديقي';
  const startParam = match && match[1] ? match[1].trim() : '';

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 عذراً، لقد تم حظر حسابك من استخدام هذا البوت.');
  }

  const params = [`v=${appVersion}`];
  if (resetVersion > 0) params.push(`reset=${resetVersion}`);
  if (startParam) params.push(`startapp=${encodeURIComponent(startParam)}`);
  const webAppUrl = `${BASE_APP_URL}?${params.join('&')}`;

  const welcomeText =
    `⚡ *مرحباً بك يا ${firstName} في ROL Mining*\n\n` +
    `• ابدأ جلسات التعدين واجمع عملات *ROL* على شبكة TON.\n` +
    `• ارفع مستوى *VIP* عبر رصيد ROL داخل محفظتك المربوطة واستفد من المكافآت وعجلة الحظ.\n` +
    `• وثّق حسابك بـ *0.04 GRAM* لاستمرار التعدين وفتح السحب.\n\n` +
    `اضغط على الزر بالأسفل لفتح الواجهة:`;

  const keyboard = [
    [{ text: '🚀 ابدأ تعدين ROL الآن', web_app: { url: webAppUrl } }]
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

bot.on('message', (msg) => {
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
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is Live and Active.');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
