# 🎧 Sulton Music — shaxsiy musiqa stansiyasi

Telegram botga yuborgan har bir qo'shiq avtomatik aniqlanib (nomi, ijrochisi, albom, janr, kayfiyat, til,
muqova, qo'shiq matni) **GitHub Pages** saytiga va **Telegram Mini App**ga joylanadi. Spotify uslubidagi
interfeys: bosh sahifa, shaxsiy tavsiyalar, kunlik mikslar, qidiruv, sevimlilar, tinglashlar soni va statistika.

- 🤖 Bot: [@CaviSpotifybot](https://t.me/CaviSpotifybot)
- 🌐 Sayt: https://sultonmusic.github.io/Spotify/

## Qanday ishlaydi

```
Siz ──(qo'shiq)──▶ Telegram bot ──▶ GitHub Actions (har 5 daqiqada)
                                     ├─ Shazam: qo'shiqni ovozidan aniqlaydi
                                     ├─ iTunes + Deezer: albom, yil, janr, muqova, BPM
                                     ├─ LRCLIB: qo'shiq matni (sinxron karaoke)
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
| `/list` | Oxirgi qo'shilgan qo'shiqlar |
| `/stats` | Kutubxona statistikasi |
| `/edit Ijrochi - Nomi` | Qo'shiq xabariga javob qilib yozing — ma'lumotni tuzatadi |
| `/edit genre=Pop mood=romantic,sad lang=uz year=2020 album=...` | Alohida maydonlarni tuzatish |
| `/delete` | Qo'shiq xabariga javob qilib — o'chiradi (yoki `/delete ID`) |
| Rasm bilan javob | Qo'shiq xabariga rasm bilan javob bersangiz, muqova almashadi |
| Oddiy matn | Kutubxonadan qidiradi |

## Sayt imkoniyatlari

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
bot/        Telegram bot + aniqlash (Shazam, iTunes, Deezer, LRCLIB, Claude AI, ffmpeg)
web/        Sayt / mini ilova (build'siz vanilla JS)
library/    songs.json, audio, muqovalar, qo'shiq matnlari (bot avtomatik to'ldiradi)
scripts/    build-site.sh — saytni yig'ish
.github/workflows/station.yml — har 5 daqiqada bot + deploy
```

Lokal sinov: `bash scripts/build-site.sh _site && python3 -m http.server -d _site 8000`
