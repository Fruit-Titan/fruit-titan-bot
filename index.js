const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

// توكن بوت ROL
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

// إنشاء خادم HTTP بسيط للاستماع للمنفذ ومنع Render من إيقاف الخدمة
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is active and running.');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('ROL Mining Bot is running successfully...');
});
