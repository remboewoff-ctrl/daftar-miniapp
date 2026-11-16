const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function getTashkentDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function diffDays(fromDateStr, toDateStr) {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('998') && digits.length === 12) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length >= 12) return `+${digits.slice(0, 12)}`;
  return digits ? `+${digits}` : '';
}

function getCustomerTotalDebt(db, phone) {
  const target = normalizePhone(phone);
  return (db.debts || [])
    .filter((d) => normalizePhone(d.phone) === target)
    .reduce((sum, d) => sum + Math.max(0, Number(d.totalAmount || 0) - Number(d.paidAmount || 0)), 0);
}

function createInitialData() {
  const today = getTashkentDateString();
  const dMinus3 = addDaysToDateString(today, -3);
  const dMinus1 = addDaysToDateString(today, -1);
  const dPlus5 = addDaysToDateString(today, 5);
  const dMinus7 = addDaysToDateString(today, -7);

  return {
    settings: {
      storeName: 'Baraka Market',
      storePhone: '+998 90 555 12 34',
      autoSendOnCreate: true,
      remindBeforeDays: 1,
      remindOnDueDate: true,
      smsRules: {
        minDebtForSms: 10000,
        highDebtThreshold: 500000,
        normalRepeatDays: 3,
        highDebtRepeatDays: 1,
      },
      templates: {
        created:
          "Hurmatli {ism}! {dokon} do'konidan {summa} so'm qarzga xarid qildingiz. Jami qarzingiz: {jami_qarz} so'm. Qaytarish muddati: {muddat}. Aloqa: {telefon}",
        beforeDue:
          "Eslatma: Hurmatli {ism}, {dokon} do'konidagi {summa} so'm qarzingizni qaytarish muddati ertaga ({muddat}). Jami qarz: {jami_qarz} so'm.",
        overdue:
          "Eslatma: Hurmatli {ism}, {dokon} do'konidan olgan {summa} so'm qarzingiz muddati ({muddat}) {kechikish} kun o'tdi. Jami qarzingiz: {jami_qarz} so'm. Tel: {telefon}",
        highDebtOverdue:
          "MUHIM OGOHLANTIRISH: Hurmatli {ism}, {dokon} do'konidagi jami qarzingiz {jami_qarz} so'mga yetgan va muddati ({muddat}) {kechikish} kun o'tib ketdi. Iltimos, bugun to'lov qiling! Tel: {telefon}",
        paid:
          "Rahmat, {ism}! {dokon} do'konidagi qarzingiz uchun {tolov} so'm qabul qilindi. Jami qoldiq qarzingiz: {jami_qarz} so'm.",
      },
    },
    debts: [
      {
        id: 'debt-101',
        customerName: 'Sardorbek Karimov',
        phone: '+998901234567',
        items: "Un 10kg, O'simlik yog'i 5L, Shakar 3kg, Choy",
        totalAmount: 780000,
        paidAmount: 100000,
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        dueDate: dMinus3,
        lastReminderDate: null,
        reminderCount: 1,
        payments: [
          {
            id: 'pay-1',
            amount: 100000,
            note: 'Qisman naqd',
            createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
          },
        ],
      },
      {
        id: 'debt-102',
        customerName: 'Dilnoza Rahmonova',
        phone: '+998934567890',
        items: 'Bolalar tagligi, Choy, Shirinliklar',
        totalAmount: 215000,
        paidAmount: 0,
        createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
        dueDate: dMinus1,
        lastReminderDate: null,
        reminderCount: 0,
        payments: [],
      },
      {
        id: 'debt-103',
        customerName: 'Jasur Toshmatov',
        phone: '+998977778899',
        items: "Go'sht 3kg, Guruch 5kg, Sabzi",
        totalAmount: 350000,
        paidAmount: 0,
        createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
        dueDate: today,
        lastReminderDate: null,
        reminderCount: 0,
        payments: [],
      },
      {
        id: 'debt-104',
        customerName: 'Madina Alimova',
        phone: '+998912345678',
        items: 'Kiryuvish kukuni, Shampun, Sovun',
        totalAmount: 145000,
        paidAmount: 0,
        createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        dueDate: dPlus5,
        lastReminderDate: null,
        reminderCount: 0,
        payments: [],
      },
      {
        id: 'debt-105',
        customerName: 'Otabek Qodirov',
        phone: '+998943210987',
        items: 'Ichimliklar va gazaklar',
        totalAmount: 180000,
        paidAmount: 180000,
        createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
        dueDate: dMinus7,
        lastReminderDate: dMinus7,
        reminderCount: 1,
        payments: [
          {
            id: 'pay-2',
            amount: 180000,
            note: "To'liq karta orqali",
            createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
          },
        ],
      },
    ],
    smsLogs: [
      {
        id: 'sms-1',
        debtId: 'debt-101',
        customerName: 'Sardorbek Karimov',
        phone: '+998901234567',
        type: 'created',
        tier: 'high',
        message: `Hurmatli Sardorbek Karimov! Baraka Market do'konidan 780 000 so'm qarzga xarid qildingiz. Jami qarzingiz: 780 000 so'm. Qaytarish muddati: ${dMinus3}. Aloqa: +998 90 555 12 34`,
        provider: 'demo',
        status: 'simulated',
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
      {
        id: 'sms-2',
        debtId: 'debt-102',
        customerName: 'Dilnoza Rahmonova',
        phone: '+998934567890',
        type: 'created',
        tier: 'normal',
        message: `Hurmatli Dilnoza Rahmonova! Baraka Market do'konidan 215 000 so'm qarzga xarid qildingiz. Jami qarzingiz: 215 000 so'm. Qaytarish muddati: ${dMinus1}. Aloqa: +998 90 555 12 34`,
        provider: 'demo',
        status: 'simulated',
        createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
      },
    ],
  };
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createInitialData(), null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  // Backward compatibility if older db.json exists
  if (!data.settings.smsRules) {
    data.settings.smsRules = {
      minDebtForSms: 10000,
      highDebtThreshold: 500000,
      normalRepeatDays: data.settings.overdueRepeatDays || 3,
      highDebtRepeatDays: 1,
    };
  }
  if (!data.settings.templates.highDebtOverdue) {
    data.settings.templates.highDebtOverdue =
      "MUHIM OGOHLANTIRISH: Hurmatli {ism}, {dokon} do'konidagi jami qarzingiz {jami_qarz} so'mga yetgan va muddati ({muddat}) {kechikish} kun o'tib ketdi. Iltimos, bugun to'lov qiling! Tel: {telefon}";
  }
  return data;
}

function writeDb(data) {
  ensureDb();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function generateId(prefix = 'id') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  readDb,
  writeDb,
  generateId,
  normalizePhone,
  getCustomerTotalDebt,
  getTashkentDateString,
  addDaysToDateString,
  diffDays,
};
