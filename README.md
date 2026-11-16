# Daftar.uz — Telegram Mini App (Qarz Daftari & Avto-SMS)

Do'konlar uchun Telegram bot ichida ochiladigan **Qarz Daftari Mini App**. Mijoz qarzga xarid qilganda telefon raqami kiritiladi, avtomatik SMS xabar yuboriladi va qarz qaytarish muddati o'tib ketsa mijozga avtomatik eslatma SMS jo'natiladi.

## Imkoniyatlar
- **Tezkor qarz yozish (POS oqimi):** `+998` formatli raqamni kiritish, avvalgi mijozni telefon raqamidan avtomatik topish, summa, mahsulotlar ro'yxati va qaytarish muddatini belgilash.
- **Jonli SMS ko'rinishi:** Qarzni saqlashdan oldin mijoz telefoniga boradigan aniq SMS matnini ko'rish.
- **Avtomatik eslatmalar (`services/scheduler.js`):**
  - Muddatdan 1–3 kun oldin eslatma;
  - Muddat kelgan kuni eslatma;
  - Muddat o'tib ketganda belgilangan oraliqda (`har 1/2/3/7 kunda`) eslatma SMS;
  - Bir kunda bir mijozga qayta-qayta spam yubormaslik himoyasi.
- **To'lovlar va SMS tarix:** Qisman yoki to'liq to'lovni qayd etish, to'lov cheki SMS yuborish, barcha SMS loglarini kuzatish.
- **Eskiz.uz integratsiyasi (`services/smsService.js`):**
  - `.env` da Eskiz login/parol kiritilmagan bo'lsa **Demo SMS** rejimida ishlaydi (barcha SMSlar saqlanadi va ekranda mijoz telefoni ko'rinishida chiqadi).
  - `SMS_PROVIDER=eskiz` va `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` kiritilsa, real SMS yuboradi.
- **Telegram WebApp SDK va Bot (`bot.js`):** Telegram mavzusi (och/tungi rejim), `HapticFeedback`, `initData` HMAC-SHA256 tekshiruvi (`services/telegramAuth.js`) va `@BotFather` Menu Button sozlash.

## Ishga tushirish
```bash
npm install
npm start
```
Server `http://0.0.0.0:3000` portida ishlaydi.

## Telegram botga ulash
1. Mini App serverini HTTPS domen ostiga joylashtiring (masalan, Nginx + SSL).
2. Botni ishga tushiring:
   ```bash
   BOT_TOKEN=123456:ABC... WEBAPP_URL=https://sizning-domeningiz.uz npm run bot
   ```
3. Yoki `@BotFather` -> `/mybots` -> Bot -> **Bot Settings** -> **Menu Button** orqali HTTPS URL ni kiriting.
