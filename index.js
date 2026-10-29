const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

// توكن البوت المباشر
const token = '9185746835:AAGyuUcuaueGvdX30zSXmhddWORdSSHfHZM';

const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  console.log('خطأ في الاتصال:', error.message);
});

// رابط الواجهة المؤكد
const WEB_APP_URL = 'https://fruit-titan.github.io/fruit-titan-app/';

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'صديقي';

  bot.sendMessage(chatId, `مرحباً بك يا ${firstName} في تطبيق تعدين **ROL** الرسمي!\n\nاضغط على الزر بالأسفل لفتح الواجهة وبدء التعدين:`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 ابدأ تعدين ROL الآن', web_app: { url: WEB_APP_URL } }
        ]
      ]
    }
  });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('البوت نشط ويعمل بنجاح.');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
