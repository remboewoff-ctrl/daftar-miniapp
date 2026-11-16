const {
  readDb,
  writeDb,
  normalizePhone,
  getCustomerTotalDebt,
  getTashkentDateString,
  diffDays,
} = require('../db');
const { formatSum, renderTemplate, sendSms } = require('./smsService');

async function runReminderCheck({ forceOverdue = false } = {}) {
  const db = readDb();
  const today = getTashkentDateString();
  const settings = db.settings;
  const rules = settings.smsRules || {
    minDebtForSms: 10000,
    highDebtThreshold: 500000,
    normalRepeatDays: 3,
    highDebtRepeatDays: 1,
  };

  const sentLogs = [];
  let skippedBelowMin = 0;
  const processedPhonesToday = new Set();

  for (const debt of db.debts) {
    const remaining = Math.max(0, Number(debt.totalAmount) - Number(debt.paidAmount || 0));
    if (remaining <= 0) continue;

    const cleanPhone = normalizePhone(debt.phone);
    if (!forceOverdue && (debt.lastReminderDate === today || processedPhonesToday.has(cleanPhone))) {
      continue;
    }

    const customerTotalDebt = getCustomerTotalDebt(db, cleanPhone);
    if (customerTotalDebt < Number(rules.minDebtForSms || 0)) {
      skippedBelowMin += 1;
      continue;
    }

    const isHighDebt = customerTotalDebt >= Number(rules.highDebtThreshold || 500000);
    const tier = isHighDebt ? 'high' : 'normal';
    const daysUntilDue = diffDays(today, debt.dueDate);

    let reminderType = null;
    let template = null;

    if (daysUntilDue < 0) {
      const repeatDays = Math.max(
        1,
        Number(isHighDebt ? rules.highDebtRepeatDays : rules.normalRepeatDays)
      );
      const daysSinceLast = debt.lastReminderDate ? diffDays(debt.lastReminderDate, today) : null;

      if (forceOverdue || daysSinceLast === null || daysSinceLast >= repeatDays) {
        reminderType = 'overdue';
        template = isHighDebt ? settings.templates.highDebtOverdue : settings.templates.overdue;
      }
    } else if (daysUntilDue === 0 && settings.remindOnDueDate) {
      reminderType = 'overdue';
      template = isHighDebt
        ? "MUHIM ESLATMA: Hurmatli {ism}, {dokon} do'konidagi jami qarzingiz {jami_qarz} so'm. Qaytarish muddati BUGUN ({muddat})! Tel: {telefon}"
        : "Eslatma: Hurmatli {ism}, {dokon} do'konidan olgan {summa} so'm qarzingizni qaytarish muddati bugun ({muddat}). Jami qarz: {jami_qarz} so'm. Tel: {telefon}";
    } else if (
      Number(settings.remindBeforeDays) > 0 &&
      daysUntilDue === Number(settings.remindBeforeDays)
    ) {
      reminderType = 'before_due';
      template = settings.templates.beforeDue;
    }

    if (!reminderType || !template) continue;

    const overdueDays = daysUntilDue < 0 ? Math.abs(daysUntilDue) : 0;
    const message = renderTemplate(template, {
      ism: debt.customerName,
      dokon: settings.storeName,
      summa: formatSum(remaining),
      jami_qarz: formatSum(customerTotalDebt),
      muddat: debt.dueDate,
      telefon: settings.storePhone,
      kechikish: overdueDays,
    });

    const log = await sendSms({
      debtId: debt.id,
      customerName: debt.customerName,
      phone: cleanPhone,
      type: reminderType,
      tier,
      message,
    });

    const freshDb = readDb();
    const target = freshDb.debts.find((d) => d.id === debt.id);
    if (target) {
      target.lastReminderDate = today;
      target.reminderCount = Number(target.reminderCount || 0) + 1;
      writeDb(freshDb);
    }

    processedPhonesToday.add(cleanPhone);
    sentLogs.push(log);
  }

  return {
    checkedAt: new Date().toISOString(),
    today,
    sentCount: sentLogs.length,
    skippedBelowMin,
    logs: sentLogs,
  };
}

function startScheduler(intervalMinutes = 60) {
  const ms = Math.max(1, Number(intervalMinutes)) * 60 * 1000;
  const timer = setInterval(() => {
    runReminderCheck().catch((err) => {
      console.error('[Scheduler xatosi]:', err.message);
    });
  }, ms);
  timer.unref();
  return timer;
}

module.exports = {
  runReminderCheck,
  startScheduler,
};
