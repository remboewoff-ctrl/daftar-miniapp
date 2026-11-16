require('node:dns').setDefaultResultOrder('ipv4first');
require('./env');

async function startBot() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL;

  if (!BOT_TOKEN || !WEBAPP_URL || WEBAPP_URL.includes('localhost')) {
    console.log(
      '[Bot] BOT_TOKEN yoki HTTPS WEBAPP_URL kiritilmagan — faqat Mini App web server ishlamoqda.'
    );
    return;
  }

  const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

  async function tgCall(method, payload) {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`${method} xatosi: ${data.description}`);
    }
    return data.result;
  }

  async function setupMenuButton() {
    await tgCall('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Qarz Daftari',
        web_app: { url: WEBAPP_URL },
      },
    });
    console.log(`[Bot] Menu Button "Qarz Daftari" -> ${WEBAPP_URL} sozlandi!`);
  }

  async function handleUpdate(update) {
    const msg = update.message;
    if (!msg || !msg.chat) return;

    const text = (msg.text || '').trim();
    if (text.startsWith('/start') || text.startsWith('/daftar')) {
      await tgCall('sendMessage', {
        chat_id: msg.chat.id,
        text:
          "📒 *Daftar.uz — Do'kon Qarz Daftari*\n\n" +
          "Mijozlarga qarzga mahsulot berish, telefon raqamiga avtomatik SMS xabar yuborish va muddati o'tgan qarzlarni eslatish uchun pastdagi tugmani bosing:",
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📱 Qarz Daftarini ochish',
                web_app: { url: WEBAPP_URL },
              },
            ],
          ],
        },
      });
    }
  }

  await setupMenuButton();
  let offset = 0;
  console.log('[Bot] Daftar.uz Telegram bot polling ishga tushdi...');

  while (true) {
    try {
      const updates = await tgCall('getUpdates', {
        offset,
        timeout: 30,
      });
      for (const upd of updates) {
        offset = upd.update_id + 1;
        await handleUpdate(upd);
      }
    } catch (err) {
      console.error('[Bot] Polling xatosi:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

if (require.main === module) {
  startBot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startBot };
