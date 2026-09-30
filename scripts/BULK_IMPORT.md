# Cavi Music ommaviy import

Bu qo'shimcha `@YuklaydiBot` qidiruv menyusidan audiolarni olib,
Cavi egasining Telegram akkaunti orqali `@CaviSpotifybot`'ga forward qiladi.
Botning mavjud audio importi o'zgarmaydi. `import_artists.txt` da 135 ta boshlang'ich
artist bor; bu reyting emas, tahrirlanadigan ro'yxat.

## Bir marta sozlash

Python 3.10+ ishlaydigan kompyuterda repo ildizidan:

```bash
python -m pip install 'telethon>=1.36,<2'
python scripts/bulk_import.py --login
```

`api_id` va `api_hash`: https://my.telegram.org → API development tools.
Login kodlari faqat o'zingizning terminalingizda yashirin kiritiladi.
Session `.cavi-import/account.session` da qoladi. Telegram Web'dagi login
bu dasturga avtomatik o'tmaydi. Cavi egasining akkaunti bilan kiring.

Keyingi ishga tushirishdan oldin `TELEGRAM_API_ID` va `TELEGRAM_API_HASH` ni
shu kompyuterning maxfiy muhit sozlamalariga joylang. Session fayli va API hash'ni
chatga, ZIP ichiga yoki GitHub commitiga qo'shmang. `.gitignore` ularni chiqarib tashlaydi.

## Bitta buyruq

```bash
python scripts/bulk_import.py --limit 1000
```

10 000 ta faylgacha:

```bash
python scripts/bulk_import.py --limit 10000 --pages-per-artist 20
```

Xuddi shu buyruqni qayta ishga tushirish qolgan joyidan davom etadi.
`--limit` oldingi ishga tushirishlarni ham qo'shib hisoblaydi; u saytga muvaffaqiyatli
qo'shilgan qo'shiqlar soni emas. Dublikat, xato va ko'rib chiqish kerak bo'lgan
fayllar ham alohida qayd etiladi. `Ctrl+C` bilan to'xtatish mumkin.

Standart: bir tugma bosiladi, audio kelishi kutiladi, keyin forward qilinadi.
Ko'pi bilan 10 ta Cavi javobi kutilayotgan audio bo'ladi. Navbat to'lganda Cavi
qayta ishlashini kutadi. Telegram FloodWait qaytarsa talab qilingan vaqt kutadi.
Bot har audio uchun javobni o'sha forward'ga reply qilib yuborishi kerak;
hozirgi `bot/main.py` aynan shunday ishlaydi, shu jumladan tahrirlangan status xabarlari.

Holat: `.cavi-import/state.json`. Audio fayllari kompyuterga yuklab olinmaydi.
Bir Telegram document ID qayta forward qilinmaydi; boshqa fayldagi bir xil qo'shiqni
Cavi botining o'zi tekshiradi. Cover/remix savollariga dastur avtomatik «Qo'shish» bosmaydi.

## Cheklovlar va to'xtashlar

- YuklaydiBot qidiruvi barcha albom va qo'shiqlar mavjudligini kafolatlamaydi.
  Birinchi natijalarga boshqa ijrochilar, remiks va jonli ijrolar ham tushishi mumkin.
- Qidiruv menyusidagi raqam va «➡️» tugmalari saqlangan formatda bo'lishi kerak.
  Sahifalar bitta xabarni tahrirlashi kutiladi. Bot interfeysi o'zgarsa moslashtirish kerak.
- Manba audio uchun 3 daqiqa, Cavi to'la navbati uchun 1 soat kutadi.
  Javob bo'lmasa xato bilan to'xtaydi; natija saqlanadi. Qayta ishga tushirishda
  avval kechikkan javobni tekshiradi, manba tugmasini ko'r-ko'rona qayta bosmaydi.
- Forward vaqtida uzilish natijasi noma'lum bo'lsa, qabul qiluvchining oxirgi 2000
  xabaridan document ID tekshiriladi. Topilmasa operator tekshiruvi talab qilinadi.
  Bu holatda avtomatik takroriy yuborish bo'lmaydi.
- GitHub Actions, aniqlash/AI xizmatlari va audio saqlash resurslari import vaqtini
  belgilaydi. 10 000 ta faylni bir zumda import qilish va bepul sig'dirish va'da qilinmaydi.

Kod sintaksisi va sun'iy Telegram javoblari bilan navbat/resume tekshirildi.
To'liq jonli importer hali ishga tushirilmagan: alohida API sozlamalari va user session kerak.
