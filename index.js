const { Telegraf, Markup } = require('telegraf');

// جلب التوكن ورابط الواجهة من المتغيرات البيئية لحمايتها
const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;

const bot = new Telegraf(token);

bot.start((ctx) => {
  ctx.reply(
    'أهلاً بك في Fruit Titan! 🚢🍎\nاضغط على الزر أدناه لبدء الاستثمار وتصفح الخطط:',
    Markup.inlineKeyboard([
      Markup.button.webApp('فتح التطبيق 🚀', webAppUrl)
    ])
  );
});

bot.launch().then(() => {
  console.log('البوت يعمل بنجاح الآن...');
});

// إيقاف آمن للسيرفر في حال إعادة التشغيل
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
