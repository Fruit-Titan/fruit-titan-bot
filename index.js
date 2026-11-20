const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const https = require('https');

const token = process.env.BOT_TOKEN || '9185746835:AAGvEhljsO4swspCFq0jssQezACLXdTsqIU';
const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || 'https://rol-mining-default-rtdb.firebaseio.com').replace(/\/+$/, '');
const BASE_APP_URL = process.env.WEBAPP_URL || 'https://fruit-titan.github.io/fruit-titan-app/';
const ADMIN_ID = 1932161126;

const bot = new TelegramBot(token, { polling: true });

let bannedUsers = new Set();
let pendingWithdrawals = [];
let totalUsersCount = 0;
let waitingForBanInput = false;
let waitingForUnbanInput = false;
let maintenanceEnabled = false;
let maintenanceMessage = 'نقوم حالياً بتحديث النظام وتحسين الأداء لضمان أفضل تجربة تعدين. سنعود للعمل قريباً.';
let appVersion = Date.now();

function firebaseRequest(method, path, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const cleanPath = path.replace(/^\/+/, '');
    const fullUrl = new URL(`${FIREBASE_DB_URL}/${cleanPath}.json`);
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;

    const req = https.request({
      hostname: fullUrl.hostname,
      path: `${fullUrl.pathname}${fullUrl.search}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(raw ? JSON.parse(raw) : null);
          } catch {
            resolve(null);
          }
        } else {
          reject(new Error(`Firebase ${method} ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function syncSystemAndStats() {
  try {
    const [sysData, usersData, withdrawalsData] = await Promise.all([
      firebaseRequest('GET', 'config/system').catch(() => null),
      firebaseRequest('GET', 'users').catch(() => ({})),
      firebaseRequest('GET', 'withdrawals').catch(() => ({}))
    ]);

    if (sysData && typeof sysData === 'object') {
      maintenanceEnabled = Boolean(sysData.maintenanceEnabled);
      if (sysData.maintenanceMessage) {
        maintenanceMessage = String(sysData.maintenanceMessage);
      }
    }

    const usersObj = usersData && typeof usersData === 'object' ? usersData : {};
    const withdrawalsObj = withdrawalsData && typeof withdrawalsData === 'object' ? withdrawalsData : {};

    totalUsersCount = Object.keys(usersObj).length;
    bannedUsers = new Set(
      Object.entries(usersObj)
        .filter(([, u]) => u && u.banned)
        .map(([uid]) => Number(uid))
        .filter(n => !Number.isNaN(n))
    );

    pendingWithdrawals = Object.entries(withdrawalsObj)
      .filter(([, w]) => w && w.status === 'pending')
      .map(([id, w]) => ({ id, ...w }));
  } catch (e) {
    console.log('Sync warning:', e.message);
  }
}

async function resetAllBalancesInFirebase() {
  const usersData = await firebaseRequest('GET', 'users');
  if (!usersData || typeof usersData !== 'object') {
    return { resetCount: 0, errorCount: 0 };
  }

  let resetCount = 0;
  let errorCount = 0;

  for (const [uidKey, uVal] of Object.entries(usersData)) {
    if (!uVal || typeof uVal !== 'object') continue;
    try {
      await firebaseRequest('PATCH', `users/${uidKey}`, {
        balance: 0,
        startTime: 0,
        resetAt: Date.now()
      });
      resetCount++;
    } catch (e) {
      console.log(`Reset failed for ${uidKey}:`, e.message);
      errorCount++;
    }
  }

  return { resetCount, errorCount };
}

function buildMaintenanceNoticeText() {
  return (
    `🛠️ *البوت قيد الصيانة حالياً*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📌 *الحالة:* جاري التطوير والصيانة الدورية\n` +
    `💬 *التفاصيل:* ${maintenanceMessage}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⏳ نعتذر عن الإزعاج المؤقت، وسنعود للعمل بأسرع وقت.`
  );
}

bot.on('polling_error', (err) => {
  console.log('Polling error:', err.message);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'صديقي';

  await syncSystemAndStats();

  if (userId !== ADMIN_ID && maintenanceEnabled) {
    return bot.sendMessage(chatId, buildMaintenanceNoticeText(), { parse_mode: 'Markdown' });
  }

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 عذراً، لقد تم حظر حسابك من استخدام هذا البوت.');
  }

  try {
    const existing = await firebaseRequest('GET', `users/${userId}`).catch(() => null);
    if (!existing || typeof existing !== 'object') {
      await firebaseRequest('PATCH', `users/${userId}`, {
        uid: String(userId),
        username: msg.from.username || '',
        firstName,
        balance: 0,
        vip: 1,
        banned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      await firebaseRequest('PATCH', `users/${userId}`, {
        username: msg.from.username || existing.username || '',
        updatedAt: Date.now()
      });
    }
  } catch (e) {
    console.log('User start error:', e.message);
  }

  const webAppUrlWithVersion = `${BASE_APP_URL}?v=${appVersion}`;
  const adminNote = (userId === ADMIN_ID && maintenanceEnabled)
    ? '\n\n⚠️ *ملاحظة:* وضع الصيانة مفعّل حالياً للمستخدمين، وأنت داخل بصلاحية المشرف للاختبار.'
    : '';

  const welcomeText = `مرحباً بك يا ${firstName} في تطبيق تعدين ROL الرسمي!\n\nاضغط على الزر بالأسفل لفتح الواجهة وبدء التعدين:${adminNote}`;
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
  sendAdminPanel(msg.chat.id);
});

async function sendAdminPanel(chatId, messageId = null) {
  await syncSystemAndStats();

  const maintBadge = maintenanceEnabled ? 'مفعّل 🔴 (وضع الصيانة)' : 'متوقف 🟢';

  const text = `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
               `👥 إجمالي المستخدمين: *${totalUsersCount}*\n` +
               `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
               `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n` +
               `🛠️ حالة وضع الصيانة: *${maintBadge}*\n\n` +
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
      {
        text: maintenanceEnabled ? '🟢 إيقاف وضع الصيانة' : '🔴 تفعيل وضع الصيانة',
        callback_data: 'admin_toggle_maintenance'
      }
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
    await sendAdminPanel(chatId, messageId);
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_toggle_maintenance') {
    maintenanceEnabled = !maintenanceEnabled;
    await firebaseRequest('PATCH', 'config/system', {
      maintenanceEnabled,
      maintenanceMessage,
      updatedAt: Date.now()
    }).catch(() => {});
    bot.answerCallbackQuery(query.id, {
      text: maintenanceEnabled ? 'تم تفعيل وضع الصيانة 🔴' : 'تم إيقاف وضع الصيانة 🟢',
      show_alert: true
    });
    await sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_confirm_reset') {
    const confirmText = `⚠️ *تحذير خطير: تصفير الأرصدة*\n\n` +
                        `هل أنت متأكد من رغبتك في تصفير جميع أرصدة وتعدين المستخدمين وإعادتهم إلى الصفر؟`;
    const buttons = [
      [{ text: '🔥 نعم، صفّر كل الحسابات الآن', callback_data: 'admin_do_reset' }],
      [{ text: '❌ تراجع', callback_data: 'admin_panel' }]
    ];
    bot.editMessageText(confirmText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_do_reset') {
    try {
      const { resetCount, errorCount } = await resetAllBalancesInFirebase();
      appVersion = Date.now();
      pendingWithdrawals = [];
      bot.answerCallbackQuery(query.id, {
        text: `تم تصفير ${resetCount} حساب بنجاح! 🧹`,
        show_alert: true
      });
      await sendAdminPanel(chatId, messageId);
      if (errorCount > 0) {
        bot.sendMessage(chatId, `⚠️ تعذر تصفير ${errorCount} حساب.`);
      }
    } catch (err) {
      bot.answerCallbackQuery(query.id, {
        text: `فشل التصفير: ${err.message}`,
        show_alert: true
      });
    }
  }
  else if (data === 'admin_withdrawals') {
    await syncSystemAndStats();
    if (pendingWithdrawals.length === 0) {
      bot.editMessageText('لا توجد طلبات سحب معلقة حالياً.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
        }
      }).catch(() => {});
      return bot.answerCallbackQuery(query.id);
    }

    const req = pendingWithdrawals[0];
    const reqUid = req.uid || req.userId || '-';
    const text = `📥 *طلب سحب معلق:*\n\n` +
                 `👤 آيدي المستخدم: \`${reqUid}\`\n` +
                 `💰 الكمية: *${req.amount || 0} ROL*\n` +
                 `🏦 المحفظة: \`${req.address || '-'}\`\n\n` +
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
    }).catch(() => {});
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('approve_')) {
    const reqId = data.replace('approve_', '');
    await firebaseRequest('PATCH', `withdrawals/${reqId}`, { status: 'approved', reviewedAt: Date.now() }).catch(() => {});
    pendingWithdrawals = pendingWithdrawals.filter(r => r.id !== reqId);
    bot.answerCallbackQuery(query.id, { text: 'تمت الموافقة بنجاح! ✅', show_alert: true });
    await sendAdminPanel(chatId, messageId);
  }
  else if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    await firebaseRequest('PATCH', `withdrawals/${reqId}`, { status: 'rejected', reviewedAt: Date.now() }).catch(() => {});
    pendingWithdrawals = pendingWithdrawals.filter(r => r.id !== reqId);
    bot.answerCallbackQuery(query.id, { text: 'تم الرفض ومصادرة العملات نهائياً! 🚫', show_alert: true });
    await sendAdminPanel(chatId, messageId);
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
    let topText = `🏆 *قائمة المتصدرين الحقيقية:*\n\n`;
    try {
      const usersData = await firebaseRequest('GET', 'users');
      const list = Object.entries(usersData && typeof usersData === 'object' ? usersData : {})
        .filter(([, u]) => u && typeof u === 'object')
        .map(([uId, u]) => ({
          uid: uId,
          username: u.username || '',
          balance: Number(u.balance || 0)
        }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 100);

      if (list.length === 0) {
        topText += `لا توجد حسابات مسجلة حالياً.`;
      } else {
        list.forEach((item, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
          const nameLabel = item.username ? `@${item.username}` : `\`${item.uid}\``;
          topText += `${medal} ${nameLabel} — *${item.balance}* ROL\n`;
        });
      }
    } catch (e) {
      topText += `تعذر جلب القائمة حالياً.`;
    }

    bot.editMessageText(topText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id);
  }
});

bot.on('message', async (msg) => {
  if (!msg.from || !msg.text) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userId === ADMIN_ID && !msg.text.startsWith('/')) {
    const targetId = parseInt(msg.text.trim(), 10);
    if (isNaN(targetId)) return;

    if (waitingForBanInput) {
      bannedUsers.add(targetId);
      waitingForBanInput = false;
      await firebaseRequest('PATCH', `users/${targetId}`, { banned: true, bannedAt: Date.now() }).catch(() => {});
      bot.sendMessage(chatId, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' });
      await sendAdminPanel(chatId);
      return;
    }

    if (waitingForUnbanInput) {
      bannedUsers.delete(targetId);
      waitingForUnbanInput = false;
      await firebaseRequest('PATCH', `users/${targetId}`, { banned: false, banReason: '' }).catch(() => {});
      bot.sendMessage(chatId, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
      await sendAdminPanel(chatId);
      return;
    }
  }

  // حجب الرسائل النصية للمستخدمين العاديين أثناء وضع الصيانة مع استثناء الأدمن
  if (userId !== ADMIN_ID && !msg.text.startsWith('/start')) {
    await syncSystemAndStats();
    if (maintenanceEnabled) {
      bot.sendMessage(chatId, buildMaintenanceNoticeText(), { parse_mode: 'Markdown' });
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
