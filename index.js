const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN || '9185746835:AAFSJXdgMJI_SH-klpoTpowKMzDQocSOqVo';
const BASE_APP_URL = process.env.WEBAPP_URL || 'https://fruit-titan.github.io/fruit-titan-app/';
const REQUIRED_CHANNEL_USERNAME = process.env.REQUIRED_CHANNEL || 'ROL_TOKN';
const ADMIN_ID = 1932161126;
const DATA_FILE = path.join(__dirname, 'rol_bot_data.json');

const bot = new TelegramBot(token, { polling: true });

let store = {
  users: {},
  withdrawals: {},
  paidTasks: [],
  system: {
    maintenanceEnabled: false,
    maintenanceMessage: 'نقوم حالياً بتحديث النظام وتحسين الأداء. سنعود للعمل قريباً.',
    allowedTesters: []
  }
};

let adminInputState = null; // 'ban' | 'unban' | 'tester' | 'history'
let appVersion = Date.now();

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        store = {
          users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
          withdrawals: parsed.withdrawals && typeof parsed.withdrawals === 'object' ? parsed.withdrawals : {},
          paidTasks: Array.isArray(parsed.paidTasks) ? parsed.paidTasks : [],
          system: {
            maintenanceEnabled: Boolean(parsed.system?.maintenanceEnabled),
            maintenanceMessage: parsed.system?.maintenanceMessage || store.system.maintenanceMessage,
            allowedTesters: Array.isArray(parsed.system?.allowedTesters) ? parsed.system.allowedTesters.map(String) : []
          }
        };
      }
    }
  } catch (e) {
    console.log('Load store notice:', e.message);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.log('Save store notice:', e.message);
  }
}

function addUserHistory(userId, source, amount, details = '', balanceAfter = null) {
  const key = String(userId);
  if (!key || key === 'guest_miner') return;
  if (!store.users[key]) {
    store.users[key] = {
      uid: key,
      username: '',
      firstName: 'Miner',
      balance: 0,
      vip: 1,
      banned: false,
      isVerified: false,
      wallet: '',
      onChainWalletROL: 0,
      refCount: 0,
      refEarn: 0,
      completedTasks: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
  if (!Array.isArray(store.users[key].history)) {
    store.users[key].history = [];
  }
  const numAmount = Number(amount || 0);
  store.users[key].history.push({
    source: String(source || 'عملية'),
    amount: numAmount,
    details: String(details || ''),
    balanceAfter: balanceAfter !== null ? Number(balanceAfter) : Number(store.users[key].balance || 0),
    timestamp: Date.now()
  });
  if (store.users[key].history.length > 100) {
    store.users[key].history = store.users[key].history.slice(-100);
  }
  store.users[key].updatedAt = Date.now();
  saveStore();
}

async function isUserSubscribedToChannel(userId) {
  try {
    const cleanId = Number(userId);
    if (!cleanId || Number.isNaN(cleanId)) return false;
    const member = await bot.getChatMember(`@${REQUIRED_CHANNEL_USERNAME}`, cleanId);
    const allowedStatuses = ['creator', 'administrator', 'member'];
    return Boolean(member && allowedStatuses.includes(member.status));
  } catch (err) {
    console.log('Channel membership check error:', err.message);
    return false;
  }
}

function getRealUsersList() {
  return Object.entries(store.users || {})
    .filter(([k, u]) => u && typeof u === 'object' && k !== 'guest_miner');
}

function getBannedSet() {
  return new Set(
    getRealUsersList()
      .filter(([, u]) => Boolean(u.banned))
      .map(([uid]) => Number(uid))
      .filter(n => !Number.isNaN(n))
  );
}

function getPendingWithdrawalsList() {
  return Object.entries(store.withdrawals || {})
    .filter(([, w]) => w && w.status === 'pending')
    .map(([id, w]) => ({ id, ...w }));
}

function resetAllBalancesLocal() {
  const list = getRealUsersList();
  let resetCount = 0;
  for (const [uidKey, uVal] of list) {
    store.users[uidKey] = {
      ...uVal,
      balance: 0,
      startTime: 0,
      resetAt: Date.now()
    };
    addUserHistory(uidKey, 'Admin Reset', 0, 'Balance reset by admin', 0);
    resetCount++;
  }
  saveStore();
  return resetCount;
}

loadStore();

bot.on('polling_error', (err) => {
  console.log('Polling error:', err.message);
});

bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'Miner';
  const startParam = match && match[1] ? match[1].trim() : '';

  const bannedUsers = getBannedSet();
  if (bannedUsers.has(userId)) {
    return bot.sendMessage(chatId, '🚫 Sorry, your account has been banned from using this bot.');
  }

  const uidStr = String(userId);
  if (!store.users[uidStr]) {
    store.users[uidStr] = {
      uid: uidStr,
      username: msg.from.username || '',
      firstName,
      balance: 0,
      vip: 1,
      banned: false,
      isVerified: false,
      wallet: '',
      onChainWalletROL: 0,
      refCount: 0,
      refEarn: 0,
      completedTasks: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (startParam && startParam.startsWith('ref_')) {
      const refId = startParam.replace('ref_', '').trim();
      if (refId && refId !== uidStr) {
        store.users[uidStr].referredBy = refId;
      }
    }
    addUserHistory(uidStr, 'Account Created', 0, 'Joined via /start', 0);
  } else {
    store.users[uidStr].username = msg.from.username || store.users[uidStr].username || '';
    store.users[uidStr].firstName = firstName;
    store.users[uidStr].updatedAt = Date.now();
    saveStore();
  }

  const maintParam = store.system.maintenanceEnabled ? '&maint=1' : '';
  const refQuery = startParam ? `&tgWebAppStartParam=${encodeURIComponent(startParam)}` : '';
  const webAppUrlWithVersion = `${BASE_APP_URL}?v=${appVersion}${maintParam}${refQuery}`;
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

function sendAdminPanel(chatId, messageId = null) {
  const realUsers = getRealUsersList();
  const totalUsersCount = realUsers.length;
  const activeHoldersCount = realUsers.filter(([, u]) => Number(u.balance || 0) > 0).length;
  const bannedUsers = getBannedSet();
  const pendingWithdrawals = getPendingWithdrawalsList();
  const maintBadge = store.system.maintenanceEnabled ? 'مفعّل في التطبيق 🔴' : 'متوقف 🟢';

  const text = `👑 *لوحة تحكم المشرف العليا (ROL Admin)*\n\n` +
               `👥 إجمالي المستخدمين الحقيقيين: *${totalUsersCount}*\n` +
               `💰 حاملو العملة داخل البوت (>0): *${activeHoldersCount}*\n` +
               `🚫 عدد المحظورين: *${bannedUsers.size}*\n` +
               `📥 طلبات السحب المعلقة: *${pendingWithdrawals.length}*\n` +
               `🛠️ صيانة التطبيق: *${maintBadge}*\n` +
               `🧪 المختبرون المسموح لهم: *${store.system.allowedTesters.length}*\n\n` +
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
      { text: '📋 المهام (الحالية والسابقة)', callback_data: 'admin_tasks_report' },
      { text: '🚫 حظر مستخدم', callback_data: 'admin_ban' }
    ],
    [
      { text: '✅ إلغاء حظر', callback_data: 'admin_unban' },
      { text: '🧪 إضافة مختبر', callback_data: 'admin_add_tester' }
    ],
    [
      {
        text: store.system.maintenanceEnabled ? '🟢 إيقاف صيانة التطبيق' : '🔴 تفعيل صيانة التطبيق',
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
  else if (data === 'admin_tasks_report') {
    const tasksList = Array.isArray(store.paidTasks) ? store.paidTasks : [];
    let report = `📋 *تقرير المهام (الحالية والسابقة):*\n\n`;

    if (tasksList.length === 0) {
      report += `_لا توجد مهام مضافة حتى الآن._`;
    } else {
      tasksList.slice().reverse().slice(0, 30).forEach((tItem, idx) => {
        const doneCnt = Number(tItem.completedCount || 0);
        const targetCnt = Number(tItem.targetUsers || 0);
        const isFinished = doneCnt >= targetCnt;
        const statusLabel = isFinished ? 'منتهية ✅' : 'نشطة 🟢';
        report += `${idx + 1}. *${tItem.label || tItem.url}* — *${statusLabel}*\n` +
                  `   👥 المنفّذون: *${doneCnt}* / *${targetCnt}* | 💎 المكافأة: *${tItem.rewardRol || 10} ROL*\n` +
                  `   🔗 \`${tItem.url || '-'}\`\n`;
      });
    }

    if (report.length > 3900) {
      report = report.slice(0, 3850) + '\n...';
    }

    bot.editMessageText(report, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 رجوع للوحة التحكم', callback_data: 'admin_panel' }]]
      }
    }).catch(() => {});
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_toggle_maintenance') {
    store.system.maintenanceEnabled = !store.system.maintenanceEnabled;
    saveStore();
    bot.answerCallbackQuery(query.id, {
      text: store.system.maintenanceEnabled ? 'تم تفعيل وضع الصيانة في التطبيق 🔴' : 'تم إيقاف وضع الصيانة 🟢',
      show_alert: true
    });
    sendAdminPanel(chatId, messageId);
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
    const resetCount = resetAllBalancesLocal();
    appVersion = Date.now();
    bot.answerCallbackQuery(query.id, {
      text: `تم تصفير ${resetCount} حساب بنجاح! 🧹`,
      show_alert: true
    });
    sendAdminPanel(chatId, messageId);
  }
  else if (data === 'admin_withdrawals') {
    const pendingWithdrawals = getPendingWithdrawalsList();
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
                 `💸 الرسوم (5%): *${req.feeAmount || 0} ROL* | الصافي: *${req.netAmount || req.amount || 0} ROL*\n` +
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
    if (store.withdrawals[reqId]) {
      store.withdrawals[reqId].status = 'approved';
      store.withdrawals[reqId].reviewedAt = Date.now();
      saveStore();
    }
    bot.answerCallbackQuery(query.id, { text: 'تمت الموافقة بنجاح! ✅', show_alert: true });
    sendAdminPanel(chatId, messageId);
  }
  else if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    if (store.withdrawals[reqId]) {
      store.withdrawals[reqId].status = 'rejected';
      store.withdrawals[reqId].reviewedAt = Date.now();
      saveStore();
    }
    bot.answerCallbackQuery(query.id, { text: 'تم الرفض ومصادرة العملات نهائياً! 🚫', show_alert: true });
    sendAdminPanel(chatId, messageId);
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
    const valid = getRealUsersList();
    const totalSupplyInBot = valid.reduce((sum, [, u]) => sum + Number(u.balance || 0), 0);
    const verifiedCount = valid.filter(([, u]) => Boolean(u.isVerified)).length;
    const walletLinkedCount = valid.filter(([, u]) => Boolean(u.wallet)).length;

    const statsMsg = `👥 *إحصائيات المستخدمين الحقيقية:*\n\n` +
                     `• إجمالي الحسابات المسجلة: *${valid.length}*\n` +
                     `• حاملو رصيد ROL (> 0): *${valid.filter(([, u]) => Number(u.balance || 0) > 0).length}*\n` +
                     `• الحسابات الموثّقة (0.04 GRAM): *${verifiedCount}*\n` +
                     `• المحافظ المربوطة: *${walletLinkedCount}*\n` +
                     `• إجمالي أرصدة ROL داخل البوت: *${Number(totalSupplyInBot.toFixed(2))} ROL*`;

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
    const list = getRealUsersList()
      .filter(([, u]) => Number(u.balance || 0) > 0)
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

bot.on('message', (msg) => {
  if (!msg.from || msg.from.id !== ADMIN_ID || !msg.text || msg.text.startsWith('/')) return;
  if (!adminInputState) return;

  const chatId = msg.chat.id;
  const targetId = parseInt(msg.text.trim(), 10);
  if (isNaN(targetId)) {
    return bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم ID صحيح.');
  }

  const currentAction = adminInputState;
  adminInputState = null;
  const strId = String(targetId);

  if (currentAction === 'ban') {
    if (!store.users[strId]) {
      store.users[strId] = { uid: strId, balance: 0, vip: 1, history: [], createdAt: Date.now() };
    }
    store.users[strId].banned = true;
    store.users[strId].bannedAt = Date.now();
    saveStore();
    bot.sendMessage(chatId, `✅ تم حظر المستخدم بنجاح: \`${targetId}\``, { parse_mode: 'Markdown' });
    sendAdminPanel(chatId);
  } else if (currentAction === 'unban') {
    if (store.users[strId]) {
      store.users[strId].banned = false;
      saveStore();
    }
    bot.sendMessage(chatId, `✅ تم فك حظر المستخدم: \`${targetId}\``, { parse_mode: 'Markdown' });
    sendAdminPanel(chatId);
  } else if (currentAction === 'tester') {
    if (!store.system.allowedTesters.includes(strId)) {
      store.system.allowedTesters.push(strId);
      saveStore();
    }
    bot.sendMessage(chatId, `🧪 تم إضافة المختبر بنجاح: \`${strId}\``, { parse_mode: 'Markdown' });
    sendAdminPanel(chatId);
  } else if (currentAction === 'history') {
    const userData = store.users[strId];
    if (!userData || typeof userData !== 'object') {
      bot.sendMessage(chatId, `⚠️ لم يتم العثور على مستخدم بالمعرف \`${strId}\`.`, { parse_mode: 'Markdown' });
      return sendAdminPanel(chatId);
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

    const entries = Array.isArray(userData.history)
      ? [...userData.history].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 25)
      : [];

    if (entries.length === 0) {
      report += `_لا توجد حركات مسجلة في السجل التفصيلي بعد._`;
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

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' }).then(() => sendAdminPanel(chatId));
  }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'GET' && parsedUrl.pathname === '/api/check-channel') {
    const targetUserId = parsedUrl.query?.userId || '';
    isUserSubscribedToChannel(targetUserId)
      .then((joined) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, joined: Boolean(joined) }));
      })
      .catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, joined: false }));
      });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/tasks') {
    const activeTasks = (store.paidTasks || []).filter(
      t => Number(t.completedCount || 0) < Number(t.targetUsers || 0)
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, tasks: activeTasks }));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tasks') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const tData = JSON.parse(body || '{}');
        const targetUsers = parseInt(tData.targetUsers || '0', 10);
        if (!tData.url || isNaN(targetUsers) || targetUsers < 50) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'Invalid task data' }));
        }
        const taskObj = {
          id: String(tData.id || `ctask_${Date.now()}_${Math.floor(Math.random() * 1000)}`),
          url: String(tData.url),
          label: String(tData.label || tData.url),
          targetUsers: targetUsers,
          completedCount: 0,
          completedBy: [],
          rewardRol: 10,
          paidGram: Number(tData.paidGram || ((targetUsers / 50) * 1).toFixed(4)),
          createdBy: String(tData.createdBy || ''),
          createdAt: Date.now()
        };
        store.paidTasks.unshift(taskObj);
        saveStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, task: taskObj }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tasks/complete') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const taskId = String(payload.taskId || '').trim();
        const uId = String(payload.uid || '').trim();
        const idx = (store.paidTasks || []).findIndex(t => String(t.id) === taskId);

        if (idx === -1) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, expired: true }));
        }

        const taskObj = store.paidTasks[idx];
        if (!Array.isArray(taskObj.completedBy)) taskObj.completedBy = [];
        if (uId && uId !== 'guest_miner' && taskObj.completedBy.includes(uId)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, alreadyCompleted: true }));
        }

        if (Number(taskObj.completedCount || 0) >= Number(taskObj.targetUsers || 0)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, expired: true }));
        }

        if (uId && uId !== 'guest_miner') {
          taskObj.completedBy.push(uId);
        }
        taskObj.completedCount = Number(taskObj.completedCount || 0) + 1;
        saveStore();

        const stillActive = taskObj.completedCount < Number(taskObj.targetUsers || 0);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, rewardRol: 10, stillActive }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/user') {
    const uId = String(parsedUrl.query?.uid || '').trim();
    const userObj = uId && store.users[uId] ? store.users[uId] : null;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      user: userObj,
      system: store.system,
      appVersion
    }));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/sync-user') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const uId = String(payload.uid || '').trim();
        if (!uId || uId === 'guest_miner') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true }));
        }
        const existing = store.users[uId] || { history: [], createdAt: Date.now() };
        store.users[uId] = {
          ...existing,
          ...payload,
          uid: uId,
          history: Array.isArray(existing.history) ? existing.history : [],
          updatedAt: Date.now()
        };
        if (payload.historyEntry && typeof payload.historyEntry === 'object') {
          store.users[uId].history.push({
            ...payload.historyEntry,
            timestamp: payload.historyEntry.timestamp || Date.now()
          });
          if (store.users[uId].history.length > 100) {
            store.users[uId].history = store.users[uId].history.slice(-100);
          }
        }
        saveStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/withdraw') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const wData = JSON.parse(body || '{}');
        const reqId = String(wData.id || `wd_${Date.now()}`);
        store.withdrawals[reqId] = {
          ...wData,
          id: reqId,
          status: 'pending',
          createdAt: wData.createdAt || Date.now()
        };
        if (wData.uid) {
          addUserHistory(wData.uid, 'Withdrawal Request', -Number(wData.amount || 0), `Net: ${wData.netAmount || 0} ROL`, 0);
        }
        saveStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ROL Mining Bot is Live and Active.');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
