# 🎧 Cavi Music — shaxsiy musiqa stansiyasi

Telegram botga yuborgan har bir qo'shiq — **fayl** yoki shunchaki **qo'shiq nomi** — avtomatik aniqlanib
(nomi, ijrochisi, albom, janr, kayfiyat, til, muqova, qo'shiq matni) **GitHub Pages** saytiga va
**Telegram Mini App**ga joylanadi. Spotify uslubidagi interfeys (🇷🇺 rus — standart, 🇬🇧 ingliz, 🇺🇿 o'zbek):
bosh sahifa, shaxsiy tavsiyalar, kunlik mikslar, qidiruv, sevimlilar, tinglashlar soni, statistika,
tasdiqlangan (☑️) ijrochi profillari, 3 tilda tarjimali sinxron matn va stories kartalari.

- 🤖 Bot: [@CaviSpotifybot](https://t.me/CaviSpotifybot)
- 🌐 Sayt: https://sultonmusic.github.io/Spotify/

## Qanday ishlaydi

```
Siz ──(fayl yoki nom)──▶ Telegram bot ──▶ GitHub Actions (har 5 daqiqada)
                                     ├─ nom yozilsa: iTunes + Deezer'dan qidiradi, bir nechta bo'lsa tanlatadi,
                                     │   rasmiy 30 soniyalik parchani oladi (fayl yuborilsa — to'liq qo'shiq)
                                     ├─ Shazam: qo'shiqni ovozidan aniqlaydi
                                     ├─ iTunes + Deezer: albom, yil, janr, muqova, BPM
                                     ├─ LRCLIB: qo'shiq matni (sinxron karaoke) + uz/ru/en tarjima
                                     ├─ Claude AI: yakuniy nom/ijrochi, janr, kayfiyat, til, teglar, tavsif
                                     ├─ ffmpeg: toza teglar, ovoz balandligi (-14 LUFS)
                                     └─ library/ ga saqlaydi ──▶ GitHub Pages (sayt + mini ilova)
```

Server kerak emas — hammasi GitHub'da, bepul.

## O'rnatish (bir marta, ~5 daqiqa)

1. **Pages'ni yoqing:** repo → *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
2. **Bot tokenini qo'shing:** *Settings → Secrets and variables → Actions → New repository secret*
   - `TELEGRAM_BOT_TOKEN` = BotFather bergan token
3. **(Tavsiya) AI teglashni yoqing:** yana bir secret:
   - `ANTHROPIC_API_KEY` = [console.anthropic.com](https://console.anthropic.com) dagi API kalit
   AI bo'lmasa ham bot ishlaydi (Shazam + katalog + qoidalar asosida), lekin AI bilan janr/kayfiyat/til
   aniqroq bo'ladi va noma'lum o'zbek qo'shiqlarini internetdan qidirib topadi.
4. **Ishga tushiring:** *Actions → Music Station → Run workflow*. Keyin bot har 5 daqiqada o'zi ishlaydi.
5. Botga `/start` yozing. **Birinchi yozgan odam stansiya egasi bo'ladi** (faqat u qo'shiq qo'sha oladi).

Bot menyusidagi **🎧 Musiqa** tugmasi saytni Telegram ichida mini ilova sifatida ochadi.

## Bot buyruqlari

| Buyruq | Vazifasi |
|---|---|
| audio / fayl / video klip yuborish | Qo'shiqni aniqlab stansiyaga qo'shadi (20 MB gacha) |
| qo'shiq nomini yozish (yoki `/add nomi`) | Rasmiy qo'shiqni topadi; bir xil nomli bir nechtasi bo'lsa — tugmalar bilan tanlaysiz |
| `/all Ijrochi` (masalan `/all Sulton`) | Ijrochining barcha qo'shiqlarini qo'shadi: avval ijrochini tanlaysiz, sonini ko'rib tasdiqlaysiz |
| `/artists` | Ijrochilar ro'yxati (☑️ = tasdiqlangan) |
| `/verify Ijrochi`, `/unverify Ijrochi` | Tasdiqlash belgisini qo'lda qo'yish / olish |
| `/merge Eski nom > To'g'ri nom` | Bir ijrochining ikki profilini birlashtirish |
| ovozli xabar | Yaqinda chalinayotgan qo'shiqni aniqlaydi (Shazam kabi) |
| `/list` | Oxirgi qo'shilgan qo'shiqlar |
| `/stats` | Kutubxona statistikasi |
| `/edit Ijrochi - Nomi` | Qo'shiq xabariga javob qilib yozing — ma'lumotni tuzatadi |
| `/edit genre=Pop mood=romantic,sad lang=uz year=2020 album=...` | Alohida maydonlarni tuzatish |
| `/delete` | Qo'shiq xabariga javob qilib — o'chiradi (yoki `/delete ID`) |
| Rasm bilan javob | Qo'shiq xabariga rasm bilan javob bersangiz, muqova almashadi |
| Oddiy matn | Kutubxonadan qidiradi |

## Nom bo'yicha qo'shilgan qo'shiqlar

Bot qo'shiqlarni internetdan yuklab olmaydi: sayt ochiq, boshqalarning qo'shiqlarini ruxsatsiz tarqatish mualliflik
huquqini buzadi (YouTube'dan audio ajratib olish uning qoidalariga ham zid). Shuning uchun nom bo'yicha qo'shilgan
qo'shiq saytda **Apple Music'ning rasmiy 30 soniyalik parchasi** bilan chiqadi ("30 son" belgisi bilan, video ham,
qo'shimcha oyna ham yo'q). Tinglashlar soniga parchalar qo'shilmaydi.

**To'liq qo'shiq uchun** — qo'shiq faylini botga yuboring yoki istalgan chatdan **forward** qiling: bot uni o'sha
qo'shiq bilan moslab, avtomatik ravishda to'liq, yuqori sifatli audioga almashtiradi (fon rejimida, qulf ekranida ham
ijro). Rasmiy parchasi topilmagan qo'shiqlar uchun bot darhol faylni so'raydi.

## Ijrochilar va ☑️ tasdiqlangan belgisi

- Har bir ijrochi uchun bitta profil: rasm, qo'shiqlar, tinglashlar, Deezer muxlislari soni, rasmiy havolalar.
- Bir ijrochining yangi qo'shig'i avtomatik o'sha profilga qo'shiladi — nomi boshqacha yozilgan bo'lsa ham
  (masalan *Shakhzoda* / *Shahzoda*): avval Deezer/Apple Music ID bo'yicha, keyin nom bo'yicha solishtiriladi.
- Ijrochi Deezer yoki Apple Music'da rasmiy sahifaga ega bo'lsa va qo'shig'i o'sha yerda bo'lsa — ☑️ tasdiqlangan.
- Saytda ko'k belgini bossangiz, yarim ekranli oyna ochiladi: ijrochi kimligi (Vikipediya, uz/ru/en),
  **Cavi Music qaysi asosda tasdiqlagani** (Deezer/Apple Music rasmiy sahifalari, relizlar mosligi yoki egasi
  tomonidan), qachondan beri, muxlislar va relizlar soni, stansiyadagi qo'shiqlar.

## Kim nima qila oladi

- **Qo'shiq qo'shish, tahrirlash, o'chirish — faqat siz (stansiya egasi)**, bot orqali.
- Saytdagi **➕ Qo'shish sahifasi** faqat sizga ko'rinadi (Telegram ID'ingiz bo'yicha; saytga faqat uning sekin
  xeshi yoziladi). U yerdan qo'shiqni nomi bo'yicha, ijrochining barcha qo'shiqlarini yoki faylni botga yuborasiz.
- **Saytni hamma ko'ra va tinglay oladi.** Har bir tashrif buyuruvchining sevimlilari va tinglashlari o'ziga tegishli.

## Sayt imkoniyatlari

- **Til:** avtomatik — ingliz tilidagi qurilmada inglizcha, qolganlarida ruscha. Yuqoridagi 🌐 tugmasi
  (yoki **C** doirasi) orqali Русский / English / O'zbekcha ga o'zgartiriladi — musiqa to'xtamaydi.
- **Qo'shiq matni tarjimasi:** 🌐 tugmasi bilan har bir sinxron qator ostida kichikroq qilib tanlangan tildagi tarjima.
- **Stories:** ⤴ → *Stories kartasi* yoki matndan **4 tagacha qatorni tanlab** — muqova va shu qatorlar bilan
  9:16 rasm (Instagram, Telegram, WhatsApp…). Havola qo'shiqni aynan kerakli soniyadan ochadi (`#/song/<id>/<soniya>`).
- **Sahifa yangilansa** ijro etilayotgan qo'shiq to'xtamaydi va boshidan boshlanmaydi — o'sha joydan davom etadi.
- **Qidiruv** tugmasini ikkinchi marta bossangiz — qidiruv maydoni faollashib, klaviatura ochiladi.
- Nusxa olish va bosib turganda chiqadigan menyular o'chirilgan.
- **Bosh sahifa:** salomlashish, tezkor tanlovlar, *Siz uchun*, *Kunlik mikslar*, yangi qo'shilganlar,
  yaqinda tinglangan, *Takror-takror*, ijrochilar, *Kashf eting*, *Unutilgan sevimlilar*, janrlar.
- **Tavsiya algoritmi:** tinglash soni, yaqinligi, sevimlilar va o'tkazib yuborishlardan did-profili tuziladi;
  ijrochi/janr/kayfiyat/til/teg/energiya o'xshashligi, yangilik bonusi, charchoq (yaqinda eshitilgan) jarimasi,
  kun vaqtiga mos energiya va kunlik kashfiyot bilan baholanadi; bir ijrochi ustun kelmasligi uchun
  xilma-xillik qo'llanadi. Navbat tugasa — o'xshash qo'shiqlar avtomatik davom etadi (autoplay radio).
- **Qidiruv:** lotin/kirill (севара = sevara), xatoga chidamli, janr/kayfiyat/teg bo'yicha ham.
- **Sevimlilar**, barcha qo'shiqlar (saralash), ijrochilar, **statistika** (tinglashlar, vaqt, top qo'shiq/ijrochi/janr, tarix).
- **Tinglashlar soni — Spotify standarti:** qo'shiq kamida **30 soniya** haqiqatan eshitilganda 1 marta hisoblanadi
  (oldinga o'tkazish hisobga olinmaydi; 30 soniyadan oldin o'tkazib yuborilsa — "skip" sifatida algoritmga ta'sir qiladi).
- **Telegram ichida** sevimlilar, tinglashlar va tarix Telegram CloudStorage orqali barcha qurilmalaringizda sinxronlanadi.
- To'liq ekran pleyer, **sinxron qo'shiq matni**, navbat, aralash/takror, qulf ekranidan boshqarish,
  ovoz balandligini tenglash, yuklab olish, ulashish, klaviatura (Space, ←/→, Shift+←/→, L, /), PWA (telefonga o'rnatish).

## Sozlamalar (ixtiyoriy)

*Settings → Secrets and variables → Actions*:

| Nomi | Turi | Ma'nosi |
|---|---|---|
| `OWNER_IDS` | secret | Qo'shiq qo'sha oladigan Telegram ID lar (vergul bilan). Bo'lmasa — birinchi yozgan odam egasi. |
| `AI_MODEL` | variable | Claude modeli (standart: `claude-opus-5-5`) |
| `AI_WEB_SEARCH` | variable | `false` — AI internetdan qidirmaydi |
| `SHAZAM` / `LYRICS` | variable | `false` — o'chirish |
| `LISTEN_SECONDS` | variable | Har ishga tushishda bot necha soniya yangi xabar kutadi (standart 120) |
| `AUDIO_STORAGE` | variable | `auto` (standart), `pages` yoki `release` |
| `PAGES_AUDIO_LIMIT_MB` | variable | `auto` rejimida saytdagi audio chegarasi (standart 700 MB), keyin GitHub Releases'ga |
| `APP_NAME` | variable | Sayt/bot nomi |
| `PUBLIC_UPLOADS` | variable | `true` — hamma qo'shiq qo'sha oladi |
| `SITE_URL` | variable | Maxsus domen bo'lsa |

## Bilish kerak bo'lgan cheklovlar

- Telegram botlari **20 MB** gacha fayllarni yuklab oladi.
- Bot GitHub Actions orqali ishlaydi, shuning uchun javob **bir necha daqiqa** kechikishi mumkin
  (GitHub rejalashtirilgan ishlarni ba'zan kechiktiradi). Sayt qo'shiqdan 1–3 daqiqa keyin yangilanadi.
- GitHub Pages sayti ~1 GB gacha. `AUDIO_STORAGE=auto` 700 MB dan keyin yangi qo'shiqlarni GitHub Releases'ga
  saqlaydi (hajm cheklovi yo'q).
- Sayt ochiq (public) — qo'shiqlaringizni havolani bilgan har kim tinglay oladi.

## Loyiha tuzilishi

```
bot/        Telegram bot + aniqlash (Shazam, iTunes, Deezer, LRCLIB, Claude AI, ffmpeg), tarjima, Vikipediya, stories
web/        Sayt / mini ilova (build'siz vanilla JS)
library/    songs.json, audio, muqovalar, qo'shiq matnlari, stories rasmlari (bot avtomatik to'ldiradi)
scripts/    build-site.sh — saytni yig'ish
.github/workflows/station.yml — har 5 daqiqada bot + deploy
```

Lokal sinov: `bash scripts/build-site.sh _site && python3 -m http.server -d _site 8000`
