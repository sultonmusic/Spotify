# 🎧 Cavi Music — shaxsiy musiqa stansiyasi

Telegram botga yuborgan (yoki forward qilgan) har bir qo'shiq fayli avtomatik aniqlanib
(nomi, ijrochisi, albom, janr, kayfiyat, til, muqova, qo'shiq matni) **GitHub Pages** saytiga va
**Telegram Mini App**ga joylanadi. Spotify uslubidagi interfeys (🇷🇺 rus — standart, 🇬🇧 ingliz, 🇺🇿 o'zbek):
bosh sahifa, shaxsiy tavsiyalar, kunlik mikslar, qidiruv, sevimlilar, tinglashlar soni, statistika,
tasdiqlangan (☑️) ijrochi profillari, 3 tilda tarjimali sinxron matn va stories kartalari.

- 🤖 Bot: [@CaviSpotifybot](https://t.me/CaviSpotifybot)
- 🌐 Sayt: https://sultonmusic.github.io/Spotify/

## Qanday ishlaydi

```
Siz ──(fayl / forward)──▶ Telegram bot ──▶ GitHub Actions (har 5 daqiqada)
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
| `/add` | Reklama qo'shish: keyin rasm yoki video yuborasiz (izohda matn va havola) |
| `/ads` | Reklamalar: statistika (necha kishi ko'rdi, o'tkazib yubordi, bosdi), to'xtatish, o'chirish |
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
| Oddiy matn | Stansiyadan qidiradi |

## Qo'shiqlar faqat fayl orqali

Qo'shiq faylini botga yuboring yoki istalgan chat/kanaldan forward qiling — shu. Bot qo'shiqlarni internetdan
(jumladan YouTube'dan) o'zi yuklab olmaydi: sayt ochiq, boshqalarning qo'shiqlarini ruxsatsiz tarqatish mualliflik
huquqini buzadi. Saytda video ham, YouTube pleyeri ham yo'q — faqat audio.

## Cover, remix, takroriy qo'shiqlar va videolar

- Bir nechta fayl yuborsangiz, avval oddiy qo'shiqlar qo'shiladi. **Cover / remix / live / karaoke** versiyalar
  (nomi yoki fayl nomidan aniqlanadi) va **takroriy** qo'shiqlar haqida bot oxirida so'raydi: «qo'shaymi?».
  Original stansiyada bo'lmasa — «📤 Avval originalni yuboraman» tugmasi: original kelgach bot yana so'raydi.
- **Qo'shiq videosi (mp4):** botga yuborsangiz, ovozidan qaysi qo'shiq ekani aniqlanadi va o'sha qo'shiqqa biriktiriladi
  (videoning kirish qismi ham hisobga olinib, ovoz bilan sinxronlanadi). Saytda video faqat to'liq ekranli pleyerda
  muqova o'rnida ovozsiz ko'rinadi (ovoz — qo'shiq faylidan); «Muqova / Video» tanlovi saqlanib qoladi.
  Saytdagi video 20 MB dan oshmaydi (bitreyt shunga moslanadi, telefonda farq sezilmaydi).

### Katta fayllar (100 MB gacha)

Oddiy Bot API botlarga 20 MB dan katta faylni bermaydi. Kattaroq fayllarni bot Telegram'ning MTProto API'si orqali
oladi — buning uchun bir marta:
1. https://my.telegram.org → telefon raqamingiz bilan kiring → *API development tools* → ilova yarating
   (nomi: masalan *Cavi Music*, platforma: *Other*) → **api_id** va **api_hash** ni oling.
2. Repo → *Settings → Secrets and variables → Actions* → ikkita secret: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`.

Shundan keyin bot 100 MB gacha audio/video qabul qiladi. Sozlanmagan bo'lsa — 20 MB gacha (video uchun 480p/360p).

## Reklama

`/add` → rasm yoki video (izohda matn va havola). Saytda:
- kuniga har bir tinglovchiga **1 marta** — musiqa pauza bo'lib, to'liq ekranda; **10 soniyadan keyin «o'tkazib yuborish»**;
- keyin — **ovozsiz, musiqa to'xtamay**, muqova o'rnida (pleyer yopiq bo'lsa — pleyer ustida kichik kartochka):
  har qo'shiqning **50-soniyasida** va **tugashiga 50 soniya qolganda**.

`/ads` — statistika: ko'rdi (to'liq ekranda / muqova o'rnida), oxirigacha ko'rdi, o'tkazib yubordi, havolani bosdi, bugun.
Hisob anonim (har bir brauzer — bitta tinglovchi, kuniga bir marta), relay (`relay/`) Durable Object'ida saqlanadi.

## DJ

Bosh sahifadagi **DJ** — o'zbek, rus yoki ingliz tilida yozing (yoki ovoz bilan ayting): «quvnoq o'zbekcha qo'shiqlar»,
«грустные песни», «something calm to relax», «Billie Eilish kabi», «10 ta yangi qo'shiq». DJ kayfiyat, janr, til,
ijrochi, temp, yil, «yangi / sevimli / mashhur» va sonni tushunadi, didingizga qarab tanlab, darhol qo'yadi.
Qo'shiq nomini yozsangiz («lovely», «play Easy On Me», xato bilan ham: «skyfal») — o'sha qo'shiq, keyin o'xshashlari;
ijrochi nomini yozsangiz («Adele», «adel qo'shiqlari», «включи Sia») — o'sha ijrochining qo'shiqlari qo'yiladi.

## Android ilova (APK)

Saytga Android brauzerdan (Telegram'dan emas) kirganlarga bosh sahifada **«Cavi Music ilovasi — Yuklab olish»**
kartasi (× bilan 2 haftaga yashiriladi) va ⚙️ sozlamalarda *Ilovani yuklab olish* chiqadi. Kompyuterda brauzer
taklif qilsa — *O'rnatish* (PWA).

- Ilova `android/` da (Trusted Web Activity: sayt Chrome'da, brauzer panelisiz, fonda ijro va qulf ekranidan
  boshqarish bilan). `.github/workflows/android.yml` uni yig'ib, **releases → android → `cavi-music.apk`** ga joylaydi.
  Ilova doim jonli saytni ko'rsatadi, shuning uchun sayt yangilanishlari uchun APK'ni qayta o'rnatish shart emas.
- **Imzo kaliti:** GitHub → Settings → Secrets → Actions'ga `ANDROID_KEYSTORE_PASSWORD` (istalgan uzun tasodifiy
  matn) qo'shing va *Android app* workflow'ini qayta ishga tushiring. Birinchi yig'ishda kalit yaratilib,
  shu parol bilan shifrlangan holda `android/signing.enc` ga saqlanadi — keyingi versiyalar eskisining ustidan
  o'rnatiladi. Secret bo'lmasa har yig'ish yangi kalit oladi (yangi versiyadan oldin eskisini o'chirish kerak).
- **Brauzer paneli (URL)**: to'liq ekran uchun Android saytning ildizida (`https://sultonmusic.github.io/.well-known/assetlinks.json`)
  ilova kaliti tasdig'ini ko'rishi kerak. Buning uchun `sultonmusic.github.io` nomli alohida repo kerak; release'dagi
  `assetlinks.json` faylini o'sha repoga `.well-known/assetlinks.json` qilib joylang. Bu bo'lmasa ilova ishlayveradi,
  faqat tepada ingichka manzil paneli ko'rinadi.
- **«Hey Google, play … on Cavi Music»**: ilova Android'ning `MEDIA_PLAY_FROM_SEARCH` so'rovini qabul qiladi va
  aytilganni DJ'ga beradi (bo'sh bo'lsa — *Siz uchun*). Buni Assistant qo'llashi qurilma/Assistant versiyasiga bog'liq.
  «Hey Google, open Cavi Music» esa ilova o'rnatilgach ishlaydi. Ilova belgisi bosib turilsa: DJ, Sevimlilar, Qidiruv.

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
  xeshi yoziladi): qanday qo'shishni ko'rsatadi va botni ochadi.
- **Saytni hamma ko'ra va tinglay oladi.** Har bir tashrif buyuruvchining sevimlilari va tinglashlari o'ziga tegishli.

## Sayt imkoniyatlari

- **Til:** avtomatik — ingliz tilidagi qurilmada inglizcha, qolganlarida ruscha. Yuqoridagi 🌐 tugmasi
  (yoki chapdagi logo) orqali Русский / English / O'zbekcha ga o'zgartiriladi — musiqa to'xtamaydi.
- **Qo'shiq matni tarjimasi:** 🌐 tugmasi bilan har bir sinxron qator ostida kichikroq qilib tanlangan tildagi tarjima.
- **Stories:** ⤴ → *Stories kartasi* yoki matndan **4 tagacha qatorni tanlab** — muqova va shu qatorlar bilan
  9:16 rasm yoki **ovozli video** (15 soniyagacha, qatorlar karaoke kabi yonadi) — Instagram, Telegram, WhatsApp…
  Instagram rasm/video ichidagi yozuvni bosiladigan qilmaydi: ulashganda qo'shiq havolasi avtomatik nusxalanadi,
  uni Instagram'dagi **«Ссылка/Link» stikeri**ga joylaysiz. Havola qo'shiqni aynan kerakli soniyadan ochadi
  (`#/song/<id>/<soniya>`).
- **Sahifa yangilansa** ijro etilayotgan qo'shiq sahifaning eng birinchi qatoridanoq (skriptlar, kutubxona
  yuklanishini kutmay) o'sha joyidan — yangilanish vaqti ham hisobga olinib — ohista davom etadi.
  **Pastga tortib yangilash** esa sahifani qayta yuklamaydi: yangi qo'shiqlar olinadi, musiqa to'xtamaydi.
- Ijro etilayotgan qo'shiqni istalgan joyda (bosh sahifa, qidiruv, ro'yxatlar) bossangiz — pauza emas,
  **to'liq ekranli pleyer** ochiladi. Pleyerni yuqoridan **pastga tortsangiz** — yopiladi.
- **Sevimlilar tartibi:** *Любимые треки* → *Изменить порядок* → qo'shiqlarni ≡ dan ushlab suring → *Готово*.
  Tartib saqlanadi (Telegram ichida barcha qurilmalaringizda ham); yangi sevimlilar tepada chiqadi.
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

## 24/7 rejim (bot darhol javob berishi uchun)

GitHub "har 5 daqiqada" jadvalini ko'pincha kechiktiradi — bot ba'zan soatlab javob bermay qoladi. Buni
**Cloudflare Workers** (bepul) tuzatadi: `relay/` har daqiqada Telegram'ni tekshiradi, xabar kelgan bo'lsa unga 👀
qo'yadi va botni darhol ishga tushiradi (javob ~1–3 daqiqada). Qo'shiqlarni u qayta ishlamaydi — faqat uyg'otadi.

Bir marta sozlanadi (~5 daqiqa):

1. **Cloudflare:** https://dash.cloudflare.com/sign-up da bepul ro'yxatdan o'ting.
   - *Profil → API Tokens → Create Token → «Edit Cloudflare Workers»* shabloni → *Continue → Create Token* — tokenni nusxalang.
   - *Account ID*: bosh sahifadagi *Workers & Pages* bo'limida o'ng tomonda.
2. **GitHub token:** https://github.com/settings/personal-access-tokens/new
   - *Repository access → Only select repositories → Spotify*
   - *Permissions → Actions → Read and write* → *Generate token* — nusxalang.
3. Repo → *Settings → Secrets and variables → Actions → New repository secret* — uchtasini qo'shing:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISPATCH_TOKEN` (2-qadamdagi GitHub token).
4. *Actions → Relay (24/7) → Run workflow.* Tayyor — shundan keyin har bir xabarga bir daqiqa ichida 👀 chiqadi.

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
android/    Android ilova (TWA) — .github/workflows/android.yml yig'adi
scripts/    build-site.sh — saytni yig'ish
.github/workflows/station.yml — har 5 daqiqada bot + deploy
```

Lokal sinov: `bash scripts/build-site.sh _site && python3 -m http.server -d _site 8000`
