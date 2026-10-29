const TelegramBot = require('node-telegram-bot-api');

// توكن بوت ROL الجديد
const token = process.env.BOT_TOKEN || '9185746835:AAGyuUcuaueGvdX30zSXmhddWORdSSHfHZM';
const bot = new TelegramBot(token, { polling: true });

// رابط تطبيق الويب على Render
const WEB_APP_URL = 'https://fruit-titan-app.onrender.com';

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'صديقي';

  bot.sendMessage(chatId, `مرحباً بك يا ${firstName} في بوت تعدين عملة **ROL** الرسمي!\n\nاضغط على الزر بالأسفل لفتح التطبيق والبدء في جمع العملات مباشرة:`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 ابدأ تعدين ROL الآن', web_app: { url: WEB_APP_URL } }
        ],
        [
          { text: '📢 قناة التحديثات', url: 'https://t.me/telegram' }
        ]
      ]
    }
  });
});

console.log('ROL Mining Bot is running successfully...');
