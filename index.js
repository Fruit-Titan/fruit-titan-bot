const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const token = process.env.BOT_TOKEN || '9185746835:AAGyuUcuaueGvdX30zSXmhddWORdSSHfHZM';
const bot = new TelegramBot(token, { polling: true });

// معرف الآدمن الخاص بك
const ADMIN_ID = 1932161126;

// قاعدة بيانات مصغرة في الذاكرة
let bannedUsers = new Set();
let pendingWithdrawals = [
  { id: 'req_1', userId: 88471209, amount: 120 },
  { id: 'req_2', userId: 99401822, amount: 50 }
];
let totalUsersCount = 1482;
let waitingForBanInput = false;
let waitingForUnbanInput = false;

const WEB_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';

// أمر البداية للمستخدمين العاديين وللآدمن
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'صديقي';

  // التحقق من الحظر
  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 عذراً، لقد تم حظر حسابك من استخدام هذا البوت.');
  }

  let welcomeText = `مرحباً بك يا ${firstName} في تطبيق تعدين ROL الرسمي!\n\nاضغط على الزر بالأسفل لفتح الواجهة وبدء التعدين:`;
  let keyboard = [
    [{ text: '🚀 ابدأ تعدين ROL الآن', web_app: { url: WEB_APP_URL } }]
  ];

  // إذا كنت أنت المشرف يظهر لك زر فتح لوحة التحكم
  if (userId === ADMIN_ID) {
    keyboard.push([{ text: '👑 لوحة تحكم المشرف (Admin)', callback_data: 'admin_panel' }]);
  }

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
});

// أمر مخصص لفتح لوحة الأدمن مباشرة
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ هذا الأمر مخصص لمالك البوت فقط.');
  }
  sendAdminPanel(msg.chat.id);
});

// دالة عرض لوحة تحكم المشرف
function sendAdminPanel(chatId, messageId = null) {
  const text = `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
               `👥 إجمالي المستخدمين: *${totalUsersCount}*\n` +
               `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
               `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n\n` +
               `اختر الإجراء المطلوب من الأزرار أدناه:`;

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

// معالجة الأزرار التفاعلية
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
    const text = `📥 *طلب سحب قيد الانتظار:*\n\n` +
                 `👤 آيدي المستخدم: \`${req.userId}\`\n` +
                 `💰 الكمية: *${req.amount} ROL*\n\n` +
                 `اختر الإجراء:`;

    const buttons = [
      [
        { text: '✅ موافقة وإرسال', callback_data: `approve_${req.id}` },
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
    bot.answerCallbackQuery(query.id, { text: 'تم الرفض ومصادرة العملات بدون إرجاع! 🚫', show_alert: true });
    sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_ban') {
    waitingForBanInput = true;
    waitingForUnbanInput = false;
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالمستخدم الذي تريد حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_unban') {
    waitingForUnbanInput = true;
    waitingForBanInput = false;
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالمستخدم الذي تريد إلغاء حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_top100') {
    let topText = `🏆 *قائمة المتصدرين (Top 100):*\n\n` +
                  `🥇 1- \`${ADMIN_ID}\` (أنت) — 2,500,000 ROL\n` +
                  `🥈 2- \`78912345\` — 1,200,000 ROL\n` +
                  `🥉 3- \`45612378\` — 950,000 ROL\n` +
                  `4- \`89123456\` — 820,000 ROL\n` +
                  `5- \`12345678\` — 610,000 ROL\n` +
                  `...\n*(باقي القائمة مسجلة في النظام)*`;

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

// استقبال نصوص الـ ID للحظر وإلغاء الحظر
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
    bot.sendMessage(msg.chat.id, `✅ تم إلغاء حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
    sendAdminPanel(msg.chat.id);
  }
});

// خادم لإبقاء البوت متصلاً على Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Bot with Admin Panel is Active');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
