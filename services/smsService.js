const { readDb, writeDb, generateId, normalizePhone } = require('../db');

let eskizToken = null;
let eskizTokenFetchedAt = 0;

function formatSum(amount) {
  return Number(amount || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function renderTemplate(template, vars) {
  return String(template || '')
    .replace(/\{ism\}/g, vars.ism ?? '')
    .replace(/\{dokon\}/g, vars.dokon ?? '')
    .replace(/\{summa\}/g, vars.summa ?? '')
    .replace(/\{jami_qarz\}/g, vars.jami_qarz ?? vars.summa ?? '')
    .replace(/\{muddat\}/g, vars.muddat ?? '')
    .replace(/\{telefon\}/g, vars.telefon ?? '')
    .replace(/\{kechikish\}/g, String(vars.kechikish ?? 0))
    .replace(/\{tolov\}/g, vars.tolov ?? '')
    .replace(/\{qoldiq\}/g, vars.qoldiq ?? '');
}

async function getEskizToken() {
  const email = process.env.ESKIZ_EMAIL;
  const password = process.env.ESKIZ_PASSWORD;
  if (!email || !password) {
    throw new Error('ESKIZ_EMAIL va ESKIZ_PASSWORD sozlanmagan');
  }

  if (eskizToken && Date.now() - eskizTokenFetchedAt < 24 * 60 * 60 * 1000) {
    return eskizToken;
  }

  const form = new FormData();
  form.append('email', email);
  form.append('password', password);

  const res = await fetch('https://notify.eskiz.uz/api/auth/login', {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Eskiz auth xatoligi (${res.status}): ${errText}`);
  }

  const json = await res.json();
  eskizToken = json?.data?.token;
  if (!eskizToken) {
    throw new Error('Eskiz token olinmadi');
  }
  eskizTokenFetchedAt = Date.now();
  return eskizToken;
}

async function sendViaEskiz(phone, message) {
  const token = await getEskizToken();
  const cleanPhone = normalizePhone(phone).replace('+', '');
  const form = new FormData();
  form.append('mobile_phone', cleanPhone);
  form.append('message', message);
  form.append('from', process.env.ESKIZ_FROM || '4546');

  const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Agar token eskirgan bo'lsa qayta login qilib ko'ramiz
    if (res.status === 401) {
      eskizToken = null;
    }
    throw new Error(data?.message || `Eskiz SMS xatoligi (${res.status})`);
  }
  return data;
}

async function sendViaPlayMobile(phone, message) {
  const login = process.env.PLAYMOBILE_LOGIN;
  const password = process.env.PLAYMOBILE_PASSWORD;
  const originator = process.env.PLAYMOBILE_ORIGINATOR || '3700';

  if (!login || !password) {
    throw new Error('PLAYMOBILE_LOGIN va PLAYMOBILE_PASSWORD sozlanmagan');
  }

  const cleanPhone = normalizePhone(phone).replace('+', '');
  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const payload = {
    messages: [
      {
        recipient: cleanPhone,
        'message-id': generateId('pm'),
        sms: {
          originator,
          content: { text: message },
        },
      },
    ],
  };

  const res = await fetch('https://send.smsxabar.uz/broker-api/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PlayMobile xatoligi (${res.status}): ${errText}`);
  }
  return true;
}

function getSmsMode() {
  const provider = (process.env.SMS_PROVIDER || 'demo').toLowerCase();
  if (provider === 'eskiz' && process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD) {
    return 'eskiz';
  }
  if (
    provider === 'playmobile' &&
    process.env.PLAYMOBILE_LOGIN &&
    process.env.PLAYMOBILE_PASSWORD
  ) {
    return 'playmobile';
  }
  return 'demo';
}

async function sendSms({ debtId, customerName, phone, type, tier, message }) {
  const normalizedPhone = normalizePhone(phone);
  const mode = getSmsMode();

  let status = 'simulated';
  let errorMessage = null;

  if (mode === 'eskiz') {
    try {
      await sendViaEskiz(normalizedPhone, message);
      status = 'sent';
    } catch (err) {
      status = 'failed';
      errorMessage = err.message;
    }
  } else if (mode === 'playmobile') {
    try {
      await sendViaPlayMobile(normalizedPhone, message);
      status = 'sent';
    } catch (err) {
      status = 'failed';
      errorMessage = err.message;
    }
  }

  const db = readDb();
  const logEntry = {
    id: generateId('sms'),
    debtId: debtId || null,
    customerName: customerName || 'Mijoz',
    phone: normalizedPhone,
    type: type || 'manual',
    tier: tier || 'normal',
    message,
    provider: mode,
    status,
    error: errorMessage,
    createdAt: new Date().toISOString(),
  };

  db.smsLogs.unshift(logEntry);
  writeDb(db);

  return logEntry;
}

module.exports = {
  formatSum,
  renderTemplate,
  sendSms,
  getSmsMode,
};
