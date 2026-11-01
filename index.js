const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const token = '9185746835:AAGvEhljsO4swspCFq0jssQezACLXdTsqIU';
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = 1932161126;

let bannedUsers = new Set();
let pendingWithdrawals = [];
let totalUsersCount = 1;
let waitingForBanInput = false;
let waitingForUnbanInput = false;

// رابط التطبيق مع إضافة معلمة الإصدار لإجبار المتصفح على التحديث
let appVersion = Date.now();
const BASE_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';

bot.on('polling_error', (error) => {
  console.log('Polling status:', error.message);
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'صديقي';

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 عذراً، لقد تم حظر حسابك من استخدام هذا البوت.');
  }

  const webAppUrlWithVersion = `${BASE_APP_URL}?v=${appVersion}`;

  let welcomeText = `مرحباً بك يا ${firstName} في تطبيق تعدين ROL الرسمي!\n\nاضغط على الزر بالأسفل لفتح الواجهة وبدء التعدين:`;
  let keyboard = [
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
  sendAdminPanel(msg.chat.id);
});

function sendAdminPanel(chatId, messageId = null) {
  const text = `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
               `👥 إجمالي المستخدمين: *${totalUsersCount}*\n` +
               `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
               `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n\n` +
               `اختر الإجراء المطلوب:`;

  const inline_keyboard = [
    [
      { text: '📥 مراجعة السحوبات', callback_data: 'admin_withdrawals' },
      { text: '🏆 قائمة Top 100', callback_data: 'admin_top100' }
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
    });
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
    sendAdminPanel(chatId, messageId);
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_confirm_reset') {
    const confirmText = `⚠️ *تحذير خطير: تصفير الأرصدة*\n\n` +
                        `هل أنت متأكد من رغبتك في تصفير جميع أرصدة وتعدين المستخدمين وإعادتهم إلى الصفر؟`;
    const buttons = [
      [
        { text: '🔥 نعم، صفّر كل الحسابات الآن', callback_data: 'admin_do_reset' }
      ],
      [
        { text: '❌ تراجع', callback_data: 'admin_panel' }
      ]
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
    // تحديث رقم الإصدار البرمجي لتنفيذ أمر التصفير عند فتح التطبيق
    appVersion = Date.now();
    pendingWithdrawals = [];
    bot.answerCallbackQuery(query.id, { text: 'تم تصفير النظام بنجاح! 🧹', show_alert: true });
    sendAdminPanel(chatId, messageId);
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
      return;
    }

    const req = pendingWithdrawals[0];
    const text = `📥 *طلب سحب معلق:*\n\n` +
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
    pendingWithdrawals = pendingWithdrawals.filter(r => r.id !== reqId);
    bot.answerCallbackQuery(query.id, { text: 'تمت الموافقة بنجاح! ✅', show_alert: true });
    sendAdminPanel(chatId, messageId);
  }
  else if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    pendingWithdrawals = pendingWithdrawals.filter(r => r.id !== reqId);
    bot.answerCallbackQuery(query.id, { text: 'تم الرفض ومصادرة العملات نهائياً! 🚫', show_alert: true });
    sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_ban') {
    waitingForBanInput = true;
    waitingForUnbanInput = false;
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_unban') {
    waitingForUnbanInput = true;
    waitingForBanInput = false;
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد فك حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_top100') {
    let topText = `🏆 *قائمة المتصدرين الحقيقية:*\n\n` +
                  `🥇 1- \`${ADMIN_ID}\` (أنت) — 0.00 ROL\n` +
                  `*(تمت إعادة ضبط وتصفير السجلات تمهيداً للإطلاق الرسمي)*`;

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

  const targetId = parseInt(msg.text.trim());
  if (isNaN(targetId)) return;

  if (waitingForBanInput) {
    bannedUsers.add(targetId);
    waitingForBanInput = false;
    bot.sendMessage(msg.chat.id, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' });
    sendAdminPanel(msg.chat.id);
  } else if (waitingForUnbanInput) {
    bannedUsers.delete(targetId);
    waitingForUnbanInput = false;
    bot.sendMessage(msg.chat.id, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
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
