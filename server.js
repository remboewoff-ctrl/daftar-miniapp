require('./env');
const express = require('express');
const path = require('path');
const {
  readDb,
  writeDb,
  generateId,
  normalizePhone,
  getCustomerTotalDebt,
  getTashkentDateString,
  diffDays,
} = require('./db');
const { formatSum, renderTemplate, sendSms, getSmsMode } = require('./services/smsService');
const { runReminderCheck, startScheduler } = require('./services/scheduler');
const { verifyTelegramInitData } = require('./services/telegramAuth');
const { startBot } = require('./bot');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', (req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  if (initData && process.env.BOT_TOKEN) {
    const check = verifyTelegramInitData(initData, process.env.BOT_TOKEN);
    if (!check.valid) {
      return res.status(401).json({ error: 'Telegram autentifikatsiyasi tasdiqlanmadi' });
    }
    req.telegramUser = check.user;
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function enrichDebt(debt, today, db) {
  const total = Number(debt.totalAmount || 0);
  const paid = Number(debt.paidAmount || 0);
  const remainingAmount = Math.max(0, total - paid);
  const daysUntilDue = diffDays(today, debt.dueDate);

  let status = 'active';
  let overdueDays = 0;

  if (remainingAmount <= 0) {
    status = 'paid';
  } else if (daysUntilDue < 0) {
    status = 'overdue';
    overdueDays = Math.abs(daysUntilDue);
  } else if (daysUntilDue === 0) {
    status = 'due_today';
  }

  const customerTotalDebt = db ? getCustomerTotalDebt(db, debt.phone) : remainingAmount;
  const rules = db?.settings?.smsRules || { minDebtForSms: 10000, highDebtThreshold: 500000 };

  let debtTier = 'normal';
  if (customerTotalDebt <= 0) debtTier = 'none';
  else if (customerTotalDebt < Number(rules.minDebtForSms || 0)) debtTier = 'small';
  else if (customerTotalDebt >= Number(rules.highDebtThreshold || 500000)) debtTier = 'high';

  return {
    ...debt,
    remainingAmount,
    customerTotalDebt,
    debtTier,
    daysUntilDue,
    overdueDays,
    status,
  };
}

app.get('/api/bootstrap', (req, res) => {
  const db = readDb();
  const today = getTashkentDateString();
  const debts = db.debts
    .map((d) => enrichDebt(d, today, db))
    .sort((a, b) => {
      const priority = { overdue: 0, due_today: 1, active: 2, paid: 3 };
      if (priority[a.status] !== priority[b.status]) {
        return priority[a.status] - priority[b.status];
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  const summary = {
    totalOutstanding: debts.reduce((s, d) => s + d.remainingAmount, 0),
    totalOverdue: debts
      .filter((d) => d.status === 'overdue')
      .reduce((s, d) => s + d.remainingAmount, 0),
    totalPaid: debts.reduce((s, d) => s + Number(d.paidAmount || 0), 0),
    overdueCount: debts.filter((d) => d.status === 'overdue').length,
    dueTodayCount: debts.filter((d) => d.status === 'due_today').length,
    highDebtCount: debts.filter((d) => d.status !== 'paid' && d.debtTier === 'high').length,
    activeCount: debts.filter((d) => d.status !== 'paid').length,
    smsCount: db.smsLogs.length,
  };

  res.json({
    today,
    smsMode: getSmsMode(),
    settings: db.settings,
    summary,
    debts,
    smsLogs: db.smsLogs.slice(0, 100),
  });
});

app.get('/api/customers/lookup', (req, res) => {
  const phone = normalizePhone(req.query.phone || '');
  if (!phone || phone.length < 13) {
    return res.json({ found: false });
  }
  const db = readDb();
  const existing = db.debts.find((d) => normalizePhone(d.phone) === phone);
  if (!existing) {
    return res.json({ found: false });
  }
  const today = getTashkentDateString();
  const activeDebts = db.debts
    .filter((d) => normalizePhone(d.phone) === phone)
    .map((d) => enrichDebt(d, today, db))
    .filter((d) => d.remainingAmount > 0);

  res.json({
    found: true,
    customerName: existing.customerName,
    phone: existing.phone,
    activeDebtTotal: activeDebts.reduce((s, d) => s + d.remainingAmount, 0),
    activeDebtCount: activeDebts.length,
  });
});

app.post('/api/debts', async (req, res) => {
  try {
    const { customerName, phone, items, totalAmount, dueDate, sendSmsNow } = req.body || {};

    const cleanName = String(customerName || '').trim();
    const cleanPhone = normalizePhone(phone);
    const amount = Number(totalAmount);

    if (!cleanName) {
      return res.status(400).json({ error: 'Mijoz ismini kiriting' });
    }
    if (!/^\+998\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ error: "Telefon raqami to'liq emas (+998 XX XXX-XX-XX)" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Qarz summasini to'g'ri kiriting" });
    }
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return res.status(400).json({ error: 'Qaytarish muddatini tanlang' });
    }

    const db = readDb();
    const newDebt = {
      id: generateId('debt'),
      customerName: cleanName,
      phone: cleanPhone,
      items: String(items || "Do'kondan xarid").trim(),
      totalAmount: Math.round(amount),
      paidAmount: 0,
      createdAt: new Date().toISOString(),
      dueDate,
      lastReminderDate: null,
      reminderCount: 0,
      payments: [],
    };

    db.debts.unshift(newDebt);
    writeDb(db);

    const customerTotalDebt = getCustomerTotalDebt(db, cleanPhone);
    const rules = db.settings.smsRules || {};
    const tier =
      customerTotalDebt >= Number(rules.highDebtThreshold || 500000)
        ? 'high'
        : customerTotalDebt < Number(rules.minDebtForSms || 0)
        ? 'small'
        : 'normal';

    let smsLog = null;
    let skippedReason = null;
    const shouldSendSms =
      typeof sendSmsNow === 'boolean' ? sendSmsNow : db.settings.autoSendOnCreate;

    if (shouldSendSms) {
      if (customerTotalDebt < Number(rules.minDebtForSms || 0)) {
        skippedReason = `Jami qarz (${formatSum(customerTotalDebt)} so'm) minimal SMS chegarasidan (${formatSum(
          rules.minDebtForSms
        )} so'm) kam`;
      } else {
        const msg = renderTemplate(db.settings.templates.created, {
          ism: newDebt.customerName,
          dokon: db.settings.storeName,
          summa: formatSum(newDebt.totalAmount),
          jami_qarz: formatSum(customerTotalDebt),
          muddat: newDebt.dueDate,
          telefon: db.settings.storePhone,
        });

        smsLog = await sendSms({
          debtId: newDebt.id,
          customerName: newDebt.customerName,
          phone: newDebt.phone,
          type: 'created',
          tier,
          message: msg,
        });
      }
    }

    const today = getTashkentDateString();
    res.status(201).json({
      debt: enrichDebt(newDebt, today, readDb()),
      smsLog,
      skippedReason,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/debts/:id/pay', async (req, res) => {
  try {
    const { amount, note, sendSmsReceipt } = req.body || {};
    const payAmount = Math.round(Number(amount));

    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: "To'lov summasi 0 dan katta bo'lishi kerak" });
    }

    const db = readDb();
    const debt = db.debts.find((d) => d.id === req.params.id);
    if (!debt) {
      return res.status(404).json({ error: 'Qarz topilmadi' });
    }

    const remainingBefore = Math.max(0, debt.totalAmount - (debt.paidAmount || 0));
    const appliedAmount = Math.min(payAmount, remainingBefore);
    if (appliedAmount <= 0) {
      return res.status(400).json({ error: "Bu qarz allaqachon to'liq yopilgan" });
    }

    debt.paidAmount = Number(debt.paidAmount || 0) + appliedAmount;
    debt.payments = debt.payments || [];
    debt.payments.unshift({
      id: generateId('pay'),
      amount: appliedAmount,
      note: String(note || "To'lov").trim(),
      createdAt: new Date().toISOString(),
    });
    writeDb(db);

    const remainingAfter = Math.max(0, debt.totalAmount - debt.paidAmount);
    const customerTotalAfter = getCustomerTotalDebt(db, debt.phone);
    let smsLog = null;

    if (sendSmsReceipt !== false) {
      const msg = renderTemplate(db.settings.templates.paid, {
        ism: debt.customerName,
        dokon: db.settings.storeName,
        tolov: formatSum(appliedAmount),
        qoldiq: formatSum(remainingAfter),
        jami_qarz: formatSum(customerTotalAfter),
        telefon: db.settings.storePhone,
      });
      smsLog = await sendSms({
        debtId: debt.id,
        customerName: debt.customerName,
        phone: debt.phone,
        type: 'payment',
        tier: 'normal',
        message: msg,
      });
    }

    const today = getTashkentDateString();
    res.json({
      debt: enrichDebt(debt, today, readDb()),
      smsLog,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/debts/:id/due-date', (req, res) => {
  const { dueDate } = req.body || {};
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return res.status(400).json({ error: "Sana formati noto'g'ri (YYYY-MM-DD)" });
  }
  const db = readDb();
  const debt = db.debts.find((d) => d.id === req.params.id);
  if (!debt) {
    return res.status(404).json({ error: 'Qarz topilmadi' });
  }
  debt.dueDate = dueDate;
  writeDb(db);
  res.json({ debt: enrichDebt(debt, getTashkentDateString(), db) });
});

app.post('/api/debts/:id/remind', async (req, res) => {
  try {
    const db = readDb();
    const debt = db.debts.find((d) => d.id === req.params.id);
    if (!debt) {
      return res.status(404).json({ error: 'Qarz topilmadi' });
    }

    const today = getTashkentDateString();
    const enriched = enrichDebt(debt, today, db);
    if (enriched.remainingAmount <= 0) {
      return res.status(400).json({ error: "To'langan qarzga eslatma yuborilmaydi" });
    }

    const isHighDebt = enriched.debtTier === 'high';
    let message = String(req.body?.customMessage || '').trim();
    if (!message) {
      let tpl;
      if (enriched.status === 'overdue') {
        tpl = isHighDebt ? db.settings.templates.highDebtOverdue : db.settings.templates.overdue;
      } else {
        tpl =
          "Eslatma: Hurmatli {ism}, {dokon} do'konidan olgan {summa} so'm qarzingizni qaytarish muddati: {muddat}. Jami qarzingiz: {jami_qarz} so'm. Tel: {telefon}";
      }

      message = renderTemplate(tpl, {
        ism: debt.customerName,
        dokon: db.settings.storeName,
        summa: formatSum(enriched.remainingAmount),
        jami_qarz: formatSum(enriched.customerTotalDebt),
        muddat: debt.dueDate,
        telefon: db.settings.storePhone,
        kechikish: enriched.overdueDays,
      });
    }

    const smsLog = await sendSms({
      debtId: debt.id,
      customerName: debt.customerName,
      phone: debt.phone,
      type: enriched.status === 'overdue' ? 'overdue' : 'manual',
      tier: enriched.debtTier,
      message,
    });

    const freshDb = readDb();
    const target = freshDb.debts.find((d) => d.id === debt.id);
    if (target) {
      target.lastReminderDate = today;
      target.reminderCount = Number(target.reminderCount || 0) + 1;
      writeDb(freshDb);
    }

    res.json({ smsLog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/debts/:id', (req, res) => {
  const db = readDb();
  const prevLen = db.debts.length;
  db.debts = db.debts.filter((d) => d.id !== req.params.id);
  if (db.debts.length === prevLen) {
    return res.status(404).json({ error: 'Qarz topilmadi' });
  }
  writeDb(db);
  res.json({ deleted: true });
});

app.post('/api/reminders/run', async (req, res) => {
  try {
    const forceOverdue = Boolean(req.body?.forceOverdue);
    const result = await runReminderCheck({ forceOverdue });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test SMS yuborish (Eskiz / PlayMobile / Demo tekshirish uchun)
app.post('/api/sms/test', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body?.phone);
    if (!/^\+998\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ error: "Test telefon raqamini to'g'ri kiriting (+998 XX XXX-XX-XX)" });
    }
    const db = readDb();
    const msg = `${db.settings.storeName}: Daftar.uz SMS tizimi muvaffaqiyatli ulandi! Tel: ${db.settings.storePhone}`;
    const smsLog = await sendSms({
      debtId: null,
      customerName: 'Test SMS',
      phone: cleanPhone,
      type: 'manual',
      tier: 'normal',
      message: msg,
    });
    res.json({ smsLog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', (req, res) => {
  const db = readDb();
  const body = req.body || {};

  const incomingRules = body.smsRules || {};
  const existingRules = db.settings.smsRules || {};

  db.settings = {
    ...db.settings,
    storeName: String(body.storeName ?? db.settings.storeName).trim() || 'Baraka Market',
    storePhone: String(body.storePhone ?? db.settings.storePhone).trim(),
    autoSendOnCreate:
      typeof body.autoSendOnCreate === 'boolean'
        ? body.autoSendOnCreate
        : db.settings.autoSendOnCreate,
    remindBeforeDays:
      body.remindBeforeDays !== undefined
        ? Math.max(0, Number(body.remindBeforeDays))
        : db.settings.remindBeforeDays,
    remindOnDueDate:
      typeof body.remindOnDueDate === 'boolean'
        ? body.remindOnDueDate
        : db.settings.remindOnDueDate,
    smsRules: {
      minDebtForSms:
        incomingRules.minDebtForSms !== undefined
          ? Math.max(0, Number(incomingRules.minDebtForSms))
          : existingRules.minDebtForSms ?? 10000,
      highDebtThreshold:
        incomingRules.highDebtThreshold !== undefined
          ? Math.max(0, Number(incomingRules.highDebtThreshold))
          : existingRules.highDebtThreshold ?? 500000,
      normalRepeatDays:
        incomingRules.normalRepeatDays !== undefined
          ? Math.max(1, Number(incomingRules.normalRepeatDays))
          : existingRules.normalRepeatDays ?? 3,
      highDebtRepeatDays:
        incomingRules.highDebtRepeatDays !== undefined
          ? Math.max(1, Number(incomingRules.highDebtRepeatDays))
          : existingRules.highDebtRepeatDays ?? 1,
    },
    templates: {
      ...db.settings.templates,
      ...(body.templates || {}),
    },
  };

  writeDb(db);
  res.json({ settings: db.settings });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'daftar-miniapp', smsMode: getSmsMode() });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Daftar.uz Mini App server http://0.0.0.0:${PORT} da ishga tushdi`);
  startScheduler(process.env.REMINDER_CHECK_MINUTES || 60);
  if (process.env.AUTO_START_BOT !== 'false') {
    startBot().catch((err) => {
      console.error('[Bot ishga tushish xatosi]:', err.message);
    });
  }
});

module.exports = server;
