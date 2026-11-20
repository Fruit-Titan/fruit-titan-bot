const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const https = require('https');

const token = process.env.BOT_TOKEN || '9185746835:AAFSJXdgMJI_SH-klpoTpowKMzDQocSOqVo';
const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || 'https://rol-mining-default-rtdb.firebaseio.com').replace(/\/+$/, '');
const BASE_APP_URL = process.env.WEBAPP_URL || 'https://fruit-titan.github.io/fruit-titan-app/';
const ADMIN_ID = 1932161126;

const bot = new TelegramBot(token, { polling: true });

let bannedUsers = new Set();
let pendingWithdrawals = [];
let totalUsersCount = 0;
let activeHoldersCount = 0;
let maintenanceEnabled = false;
let maintenanceMessage = 'نقوم حالياً بتحديث النظام وتحسين الأداء. سنعود للعمل قريباً.';
let allowedTesters = [];
let adminInputState = null; // 'ban' | 'unban' | 'tester' | 'history'
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
      if (sysData.maintenanceMessage) maintenanceMessage = String(sysData.maintenanceMessage);
      allowedTesters = Array.isArray(sysData.allowedTesters) ? sysData.allowedTesters.map(String) : [];
    }

    const usersObj = usersData && typeof usersData === 'object' ? usersData : {};
    const withdrawalsObj = withdrawalsData && typeof withdrawalsData === 'object' ? withdrawalsData : {};

    const validUserEntries = Object.entries(usersObj).filter(([k, u]) => u && typeof u === 'object' && k !== 'guest_miner');
    totalUsersCount = validUserEntries.length;
    activeHoldersCount = validUserEntries.filter(([, u]) => Number(u.balance || 0) > 0).length;
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

bot.on('polling_error', (err) => {
  console.log('Polling error:', err.message);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'Miner';

  await syncSystemAndStats();

  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 Sorry, your account has been banned from using this bot.');
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
    console.log('User start sync error:', e.message);
  }

  const maintParam = maintenanceEnabled ? '&maint=1' : '';
  const webAppUrlWithVersion = `${BASE_APP_URL}?v=${appVersion}${maintParam}`;
  const welcomeText = `Welcome ${firstName} to the official ROL Mining app!\n\nTap the button below to launch the mini app and start mining:`;
  const keyboard = [
    [{ text: '🚀 Start ROL Mining Now', web_app: { url: webAppUrlWithVersion } }]
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

  const maintBadge = maintenanceEnabled ? 'مفعّل في التطبيق 🔴' : 'متوقف 🟢';

  const text = `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
               `👥 إجمالي المستخدمين الحقيقيين: *${totalUsersCount}*\n` +
               `💰 حاملو العملة داخل البوت (>0): *${activeHoldersCount}*\n` +
               `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
               `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n` +
               `🛠️ صيانة التطبيق: *${maintBadge}*\n` +
               `🧪 المختبرون المسموح لهم: *${allowedTesters.length}*\n\n` +
               `اختر الإجراء المطلوب:`;

  const inline_keyboard = [
    [
      { text: '📥 مراجعة السحوبات', callback_data: 'admin_withdrawals' },
      { text: '🏆 Top 100 حاملي العملة', callback_data: 'admin_top100' }
    ],
    [
      { text: '📜 سجل مستخدم (History)', callback_data: 'admin_user_history' },
      { text: '👥 إحصائيات المستخدمين', callback_data: 'admin_real_users' }
    ],
    [
      { text: '🚫 حظر مستخدم', callback_data: 'admin_ban' },
      { text: '✅ إلغاء حظر', callback_data: 'admin_unban' }
    ],
    [
      {
        text: maintenanceEnabled ? '🟢 إيقاف صيانة التطبيق' : '🔴 تفعيل صيانة التطبيق',
        callback_data: 'admin_toggle_maintenance'
      },
      { text: '🧪 إضافة مختبر', callback_data: 'admin_add_tester' }
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
      allowedTesters,
      updatedAt: Date.now()
    }).catch(() => {});
    bot.answerCallbackQuery(query.id, {
      text: maintenanceEnabled ? 'تم تفعيل وضع الصيانة في التطبيق 🔴' : 'تم إيقاف وضع الصيانة 🟢',
      show_alert: true
    });
    await sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_add_tester') {
    adminInputState = 'tester';
    bot.sendMessage(chatId, 'أرسل الآن Telegram ID الخاص بالمختبر للسماح له بدخول التطبيق أثناء الصيانة:');
    bot.answerCallbackQuery(query.id);
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
    adminInputState = 'ban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_unban') {
    adminInputState = 'unban';
    bot.sendMessage(chatId, 'أرسل الآن الـ ID الخاص بالحساب المراد فك حظره:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_real_users') {
    await syncSystemAndStats();
    let statsMsg = `👥 *إحصائيات المستخدمين الحقيقية:*\n\n`;
    try {
      const usersData = await firebaseRequest('GET', 'users');
      const valid = Object.entries(usersData && typeof usersData === 'object' ? usersData : {})
        .filter(([k, u]) => u && typeof u === 'object' && k !== 'guest_miner');
      const totalSupplyInBot = valid.reduce((sum, [, u]) => sum + Number(u.balance || 0), 0);
      const verifiedCount = valid.filter(([, u]) => Boolean(u.isVerified)).length;
      const walletLinkedCount = valid.filter(([, u]) => Boolean(u.wallet)).length;

      statsMsg += `• إجمالي الحسابات المسجلة: *${valid.length}*\n` +
                  `• حاملو رصيد ROL (> 0): *${valid.filter(([, u]) => Number(u.balance || 0) > 0).length}*\n` +
                  `• الحسابات الموثّقة (0.04 GRAM): *${verifiedCount}*\n` +
                  `• المحافظ المربوطة: *${walletLinkedCount}*\n` +
                  `• إجمالي أرصدة ROL داخل البوت: *${Number(totalSupplyInBot.toFixed(2))} ROL*`;
    } catch (e) {
      statsMsg += `تعذر جلب البيانات حالياً.`;
    }
    bot.editMessageText(statsMsg, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_user_history') {
    adminInputState = 'history';
    bot.sendMessage(chatId, '📜 أرسل الآن *Telegram ID* الخاص بالمستخدم لعرض سجل جمع عملاته بالتفصيل (History):', {
      parse_mode: 'Markdown'
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_top100') {
    let topText = `🏆 *أكبر 100 حامل لعملة ROL داخل البوت:*\n\n`;
    try {
      const usersData = await firebaseRequest('GET', 'users');
      const list = Object.entries(usersData && typeof usersData === 'object' ? usersData : {})
        .filter(([k, u]) => u && typeof u === 'object' && k !== 'guest_miner' && Number(u.balance || 0) > 0)
        .map(([uId, u]) => ({
          uid: uId,
          username: u.username || '',
          balance: Number(u.balance || 0),
          verified: u.isVerified ? '✅' : '⏳'
        }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 100);

      if (list.length === 0) {
        topText += `لا يوجد حاملو عملة برصيد أكبر من 0 حالياً.`;
      } else {
        list.forEach((item, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
          const nameLabel = item.username ? `@${item.username} (\`${item.uid}\`)` : `\`${item.uid}\``;
          topText += `${medal} ${nameLabel} ${item.verified} — *${item.balance}* ROL\n`;
        });
      }
    } catch (e) {
      topText += `تعذر جلب القائمة حالياً.`;
    }

    if (topText.length > 3900) {
      topText = topText.slice(0, 3850) + '\n...';
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
  if (!msg.from || msg.from.id !== ADMIN_ID || !msg.text || msg.text.startsWith('/')) return;
  if (!adminInputState) return;

  const chatId = msg.chat.id;
  const targetId = parseInt(msg.text.trim(), 10);
  if (isNaN(targetId)) {
    return bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم ID صحيح.');
  }

  const currentAction = adminInputState;
  adminInputState = null;

  if (currentAction === 'ban') {
    bannedUsers.add(targetId);
    await firebaseRequest('PATCH', `users/${targetId}`, { banned: true, bannedAt: Date.now() }).catch(() => {});
    bot.sendMessage(chatId, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' });
    await sendAdminPanel(chatId);
  } else if (currentAction === 'unban') {
    bannedUsers.delete(targetId);
    await firebaseRequest('PATCH', `users/${targetId}`, { banned: false, banReason: '' }).catch(() => {});
    bot.sendMessage(chatId, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
    await sendAdminPanel(chatId);
  } else if (currentAction === 'tester') {
    const strId = String(targetId);
    if (!allowedTesters.includes(strId)) allowedTesters.push(strId);
    await firebaseRequest('PATCH', 'config/system', {
      maintenanceEnabled,
      maintenanceMessage,
      allowedTesters,
      updatedAt: Date.now()
    }).catch(() => {});
    bot.sendMessage(chatId, `🧪 تم إضافة المختبر بنجاح: \`${strId}\``, { parse_mode: 'Markdown' });
    await sendAdminPanel(chatId);
  } else if (currentAction === 'history') {
    const strId = String(targetId);
    try {
      const userData = await firebaseRequest('GET', `users/${strId}`);
      if (!userData || typeof userData !== 'object') {
        await bot.sendMessage(chatId, `⚠️ لم يتم العثور على مستخدم بالمعرف \`${strId}\`.`, { parse_mode: 'Markdown' });
        return await sendAdminPanel(chatId);
      }

      const uname = userData.username ? `@${userData.username}` : 'بدون يوزر';
      const bal = Number(userData.balance || 0);
      const onChain = Number(userData.onChainWalletROL || 0);
      const refs = Number(userData.refCount || 0);
      const refEarn = Number(userData.refEarn || 0);
      const verifiedTxt = userData.isVerified ? 'موثّق ✅' : 'غير موثّق ❌';
      const walletTxt = userData.wallet ? `\`${userData.wallet}\`` : 'غير مربوطة';
      const tasksDone = Array.isArray(userData.completedTasks) ? userData.completedTasks.length : 0;

      let report = `📜 *سجل المستخدم (User History):*\n\n` +
                   `👤 المعرف: \`${strId}\` (${uname})\n` +
                   `💰 الرصيد الحالي في البوت: *${bal} ROL*\n` +
                   `💎 رصيد المحفظة على الشبكة: *${onChain} ROL*\n` +
                   `🛡️ حالة التوثيق: *${verifiedTxt}*\n` +
                   `🏦 المحفظة: ${walletTxt}\n` +
                   `👥 الإحالات المؤكدة: *${refs}* (أرباحها: *${refEarn} ROL*)\n` +
                   `✅ المهام المكتملة: *${tasksDone}*\n\n` +
                   `📊 *آخر العمليات ومصادر جمع العملات:*\n`;

      const histObj = userData.history && typeof userData.history === 'object' ? userData.history : {};
      const entries = Object.values(histObj)
        .filter(item => item && typeof item === 'object')
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, 25);

      if (entries.length === 0) {
        report += `_لا توجد حركات مسجلة في السجل التفصيلي بعد (سيتم تسجيل كل عملية تعدين، سبين، مهمة، حضور يومي، أو إحالة تلقائياً)._`;
      } else {
        entries.forEach((ev, idx) => {
          const dt = ev.timestamp ? new Date(ev.timestamp).toISOString().replace('T', ' ').slice(0, 16) : '-';
          const sign = Number(ev.amount || 0) >= 0 ? '+' : '';
          const det = ev.details ? ` (${ev.details})` : '';
          report += `${idx + 1}. *${ev.source || 'عملية'}*: *${sign}${ev.amount} ROL*${det}\n   🕒 ${dt} UTC\n`;
        });
      }

      if (report.length > 3950) {
        report = report.slice(0, 3900) + '\n...';
      }

      await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
    } catch (e) {
      await bot.sendMessage(chatId, `⚠️ تعذر جلب سجل المستخدم: ${e.message}`);
    }
    await sendAdminPanel(chatId);
  }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is Live and Active.');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
