// Site languages: Russian (default), English, Uzbek. Chosen automatically, changeable in Settings.
import { tg } from "./tg.js";

export const LANGS_UI = { ru: "Русский", en: "English", uz: "O'zbekcha" };
const LS_KEY = "ms.lang";

function detect() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && LANGS_UI[saved]) return saved;
  } catch { /* storage blocked */ }
  const code = (tg?.initDataUnsafe?.user?.language_code || navigator.language || "ru").slice(0, 2).toLowerCase();
  return code === "en" ? "en" : "ru"; // Russian unless the device is in English
}

export let LANG = detect();
document.documentElement.lang = LANG;

/** Switches the language in place (no reload, so the music keeps playing). */
export function setLang(code) {
  if (!LANGS_UI[code] || code === LANG) return;
  try { localStorage.setItem(LS_KEY, code); } catch { /* ignore */ }
  LANG = code;
  document.documentElement.lang = code;
  window.dispatchEvent(new Event("app:lang"));
}

// ------------------------------------------------------------------ UI strings
// Plural forms: ru [one, few, many], en [one, other], uz [one]
const S = {
  "nav.home": { ru: "Главная", en: "Home", uz: "Bosh sahifa" },
  "nav.search": { ru: "Поиск", en: "Search", uz: "Qidiruv" },
  "nav.library": { ru: "Медиатека", en: "Library", uz: "Kutubxona" },
  "nav.yourLibrary": { ru: "Моя медиатека", en: "Your Library", uz: "Kutubxonangiz" },

  "greet.morning": { ru: "Доброе утро", en: "Good morning", uz: "Xayrli tong" },
  "greet.day": { ru: "Добрый день", en: "Good afternoon", uz: "Xayrli kun" },
  "greet.evening": { ru: "Добрый вечер", en: "Good evening", uz: "Xayrli kech" },
  "greet.night": { ru: "Доброй ночи", en: "Good night", uz: "Xayrli tun" },

  "common.all": { ru: "Все", en: "Show all", uz: "Hammasi" },
  "common.songs": { ru: ["{n} песня", "{n} песни", "{n} песен"], en: ["{n} song", "{n} songs"], uz: ["{n} ta qo'shiq"] },
  "common.plays": { ru: ["{n} прослушивание", "{n} прослушивания", "{n} прослушиваний"], en: ["{n} play", "{n} plays"], uz: ["{n} marta tinglangan"] },
  "common.times": { ru: ["{n} раз", "{n} раза", "{n} раз"], en: ["{n} time", "{n} times"], uz: ["{n} marta"] },
  "common.fans": { ru: ["{n} подписчик", "{n} подписчика", "{n} подписчиков"], en: ["{n} fan", "{n} fans"], uz: ["{n} muxlis"] },
  "common.artist": { ru: "Исполнитель", en: "Artist", uz: "Ijrochi" },
  "common.song": { ru: "Песня", en: "Song", uz: "Qo'shiq" },
  "common.playlist": { ru: "Плейлист", en: "Playlist", uz: "Pleylist" },
  "common.mix": { ru: "Микс", en: "Mix", uz: "Miks" },
  "common.genre": { ru: "Жанр", en: "Genre", uz: "Janr" },
  "common.mood": { ru: "Настроение", en: "Mood", uz: "Kayfiyat" },
  "common.language": { ru: "Язык", en: "Language", uz: "Til" },
  "common.album": { ru: "Альбом", en: "Album", uz: "Albom" },
  "common.back": { ru: "Назад", en: "Back", uz: "Orqaga" },
  "common.play": { ru: "Слушать", en: "Play", uz: "Ijro" },
  "common.shuffle": { ru: "Перемешать", en: "Shuffle", uz: "Aralash" },
  "common.repeat": { ru: "Повтор", en: "Repeat", uz: "Takrorlash" },
  "common.radio": { ru: "Радио", en: "Radio", uz: "Radio" },
  "common.more": { ru: "Ещё", en: "More", uz: "Ko'proq" },
  "common.like": { ru: "Нравится", en: "Like", uz: "Sevimli" },
  "common.share": { ru: "Поделиться", en: "Share", uz: "Ulashish" },
  "common.download": { ru: "Скачать", en: "Download", uz: "Yuklab olish" },
  "common.close": { ru: "Закрыть", en: "Close", uz: "Yopish" },
  "common.prev": { ru: "Предыдущий", en: "Previous", uz: "Oldingi" },
  "common.next": { ru: "Следующий", en: "Next", uz: "Keyingi" },
  "common.lyrics": { ru: "Текст песни", en: "Lyrics", uz: "Qo'shiq matni" },
  "common.queue": { ru: "Очередь", en: "Queue", uz: "Navbat" },
  "common.volume": { ru: "Громкость", en: "Volume", uz: "Ovoz" },
  "common.retry": { ru: "Повторить", en: "Retry", uz: "Qayta urinish" },
  "common.homeBtn": { ru: "На главную", en: "Go home", uz: "Bosh sahifa" },
  "common.verified": { ru: "Подтверждённый исполнитель", en: "Verified artist", uz: "Tasdiqlangan ijrochi" },
  "common.and": { ru: "и другие", en: "and more", uz: "va boshqalar" },

  "empty.lib.title": { ru: "Медиатека пока пуста", en: "The library is empty", uz: "Kutubxona hozircha bo'sh" },
  "empty.lib.desc": { ru: "Музыку сюда добавляет владелец станции через Telegram-бота.", en: "Songs are added by the station owner via the Telegram bot.", uz: "Qo'shiqlarni stansiya egasi Telegram bot orqali qo'shadi." },

  "home.forYou": { ru: "Для вас", en: "Made for you", uz: "Siz uchun" },
  "home.forYouSub": { ru: "Подобрано по вашему вкусу", en: "Picked from your taste", uz: "Did-profilingiz asosida tanlandi" },
  "home.dailyMixes": { ru: "Ваши миксы дня", en: "Your daily mixes", uz: "Kunlik mikslaringiz" },
  "home.dailyMix": { ru: "Микс дня {n}", en: "Daily Mix {n}", uz: "Kunlik miks {n}" },
  "home.new": { ru: "Новые песни", en: "Recently added", uz: "Yangi qo'shilganlar" },
  "home.recent": { ru: "Недавно прослушано", en: "Recently played", uz: "Yaqinda tinglangan" },
  "home.repeat": { ru: "На повторе", en: "On repeat", uz: "Takror-takror" },
  "home.repeatSub": { ru: "Что вы чаще всего слушали за 30 дней", en: "What you played most in 30 days", uz: "So'nggi 30 kunda eng ko'p qaytgan qo'shiqlaringiz" },
  "home.artists": { ru: "Исполнители", en: "Artists", uz: "Ijrochilar" },
  "home.discover": { ru: "Открытия", en: "Discover", uz: "Kashf eting" },
  "home.discoverSub": { ru: "Вы ещё не слушали, но вам может понравиться", en: "Not played yet, but you may like it", uz: "Hali tinglamagan, lekin sizga yoqishi mumkin" },
  "home.forgotten": { ru: "Забытые любимые", en: "Forgotten favourites", uz: "Unutilgan sevimlilar" },
  "home.top": { ru: "Самое прослушиваемое", en: "Your top songs", uz: "Eng ko'p tinglanganlar" },
  "home.genres": { ru: "Жанры", en: "Genres", uz: "Janrlar" },
  "home.liked": { ru: "Любимые треки", en: "Liked Songs", uz: "Sevimli qo'shiqlar" },
  "home.mixed": { ru: "Разное", en: "Mixed", uz: "Aralash" },

  "search.title": { ru: "Поиск", en: "Search", uz: "Qidiruv" },
  "search.placeholder": { ru: "Песня, исполнитель, жанр или настроение…", en: "Songs, artists, genres or moods…", uz: "Qo'shiq, ijrochi, janr yoki kayfiyat…" },
  "search.clear": { ru: "Очистить", en: "Clear", uz: "Tozalash" },
  "search.none": { ru: "Ничего не найдено по запросу «{q}»", en: "No results for “{q}”", uz: "«{q}» topilmadi" },
  "search.noneHint": { ru: "Попробуйте написать по-другому.", en: "Try a different spelling.", uz: "Boshqacha yozib ko'ring." },
  "search.top": { ru: "Лучший результат", en: "Top result", uz: "Eng mos natija" },
  "search.songs": { ru: "Песни", en: "Songs", uz: "Qo'shiqlar" },
  "search.artists": { ru: "Исполнители", en: "Artists", uz: "Ijrochilar" },
  "search.categories": { ru: "Жанры и настроения", en: "Genres & moods", uz: "Janr va kayfiyatlar" },
  "search.moods": { ru: "Настроения", en: "Moods", uz: "Kayfiyatlar" },
  "search.langs": { ru: "Языки", en: "Languages", uz: "Tillar" },
  "search.ctx": { ru: "Поиск «{q}»", en: "Search “{q}”", uz: "«{q}» qidiruvi" },

  "lib.favs": { ru: "Любимые", en: "Liked", uz: "Sevimlilar" },
  "lib.songs": { ru: "Песни", en: "Songs", uz: "Qo'shiqlar" },
  "lib.artists": { ru: "Исполнители", en: "Artists", uz: "Ijrochilar" },
  "lib.stats": { ru: "Статистика", en: "Stats", uz: "Statistika" },
  "lib.noFavs": { ru: "Здесь пока пусто", en: "Nothing here yet", uz: "Sevimlilar hali yo'q" },
  "lib.noFavsDesc": { ru: "Нажмите ♡ рядом с песней — и она появится здесь.", en: "Tap ♡ next to a song to save it here.", uz: "Qo'shiq yonidagi ♡ tugmasini bosing — u shu yerda saqlanadi." },
  "lib.reorder": { ru: "Изменить порядок", en: "Reorder", uz: "Tartibni o'zgartirish" },
  "lib.reorderHint": { ru: "Тяните за ≡", en: "Drag by ≡", uz: "≡ dan ushlab suring" },
  "common.done": { ru: "Готово", en: "Done", uz: "Tayyor" },
  "common.cancel": { ru: "Отмена", en: "Cancel", uz: "Bekor qilish" },
  "toast.orderSaved": { ru: "Порядок сохранён", en: "Order saved", uz: "Tartib saqlandi" },
  "lib.allSongs": { ru: "Все песни", en: "All songs", uz: "Barcha qo'shiqlar" },
  "lib.sort": { ru: "Сортировка", en: "Sort", uz: "Saralash" },
  "sort.added": { ru: "По дате добавления", en: "Recently added", uz: "Qo'shilgan sana" },
  "sort.title": { ru: "По названию", en: "Title (A–Z)", uz: "Nomi (A–Z)" },
  "sort.artist": { ru: "По исполнителю", en: "Artist (A–Z)", uz: "Ijrochi (A–Z)" },
  "sort.plays": { ru: "Самые прослушиваемые", en: "Most played", uz: "Ko'p tinglangan" },
  "sort.recent": { ru: "Недавно прослушанные", en: "Recently played", uz: "Yaqinda tinglangan" },

  "stats.plays": { ru: "прослушиваний", en: "plays", uz: "tinglashlar" },
  "stats.time": { ru: "время прослушивания", en: "listening time", uz: "tinglash vaqti" },
  "stats.songs": { ru: "песен", en: "songs", uz: "qo'shiqlar" },
  "stats.favs": { ru: "любимых", en: "liked", uz: "sevimlilar" },
  "stats.note": { ru: "Прослушивание засчитывается, если песня звучала не меньше {n} секунд (стандарт Spotify).", en: "A play counts after at least {n} seconds of listening (the Spotify standard).", uz: "Tinglash hisoblanadi: qo'shiq kamida {n} soniya eshitilganda (Spotify standarti)." },
  "stats.synced": { ru: "Синхронизируется между вашими устройствами через Telegram.", en: "Synced across your devices via Telegram.", uz: "Telegram hisobingiz orqali barcha qurilmalarda sinxronlanadi." },
  "stats.topSongs": { ru: "Самые прослушиваемые песни", en: "Top songs", uz: "Eng ko'p tinglangan qo'shiqlar" },
  "stats.topArtists": { ru: "Топ исполнителей", en: "Top artists", uz: "Top ijrochilar" },
  "stats.genresFav": { ru: "Любимые жанры", en: "Favourite genres", uz: "Sevimli janrlaringiz" },
  "stats.genresLib": { ru: "Жанры в медиатеке", en: "Genres in the library", uz: "Kutubxonadagi janrlar" },
  "stats.history": { ru: "История прослушивания", en: "Listening history", uz: "Tinglash tarixi" },
  "stats.empty": { ru: "Статистики пока нет", en: "No stats yet", uz: "Hali statistika yo'q" },
  "stats.emptyDesc": { ru: "Слушайте музыку — цифры появятся здесь.", en: "Play some music and the numbers will show up here.", uz: "Qo'shiq tinglang — hisob-kitoblar shu yerda paydo bo'ladi." },

  "mix.foryou.desc": { ru: "Обновляется каждый день с учётом вашего вкуса, времени и настроения.", en: "Updated daily from your taste, the time of day and mood.", uz: "Did-profilingiz, vaqt va kayfiyatga qarab har kuni yangilanadi." },
  "mix.new.desc": { ru: "Последние песни, добавленные на станцию.", en: "The latest songs added to the station.", uz: "Stansiyaga eng so'nggi qo'shilgan qo'shiqlar." },
  "mix.recent.desc": { ru: "Что вы слушали в последнее время.", en: "What you've been listening to.", uz: "Oxirgi tinglagan qo'shiqlaringiz." },
  "mix.repeat.desc": { ru: "Песни, к которым вы возвращались чаще всего за 30 дней.", en: "Songs you came back to most in the last 30 days.", uz: "So'nggi 30 kunda eng ko'p qaytgan qo'shiqlaringiz." },
  "mix.discover.desc": { ru: "Вы ещё не слушали эти песни, но они в вашем вкусе.", en: "Songs you haven't played yet that fit your taste.", uz: "Hali tinglamagan, lekin didingizga mos qo'shiqlar." },
  "mix.forgotten.desc": { ru: "Любимые песни, которые вы давно не слушали.", en: "Favourites you haven't heard in a while.", uz: "Anchadan beri eshitmagan sevimli qo'shiqlaringiz." },
  "mix.top.desc": { ru: "Ваш личный чарт.", en: "Your personal chart.", uz: "Sizning shaxsiy chartingiz." },
  "mix.daily.desc": { ru: "Обновляется каждый день.", en: "Updated every day.", uz: "Har kuni yangilanadi." },
  "mix.notFound": { ru: "Микс не найден", en: "Mix not found", uz: "Miks topilmadi" },
  "genre.desc": { ru: "Отсортировано по вашему вкусу.", en: "Sorted by your taste.", uz: "Sizga mosligi bo'yicha saralangan." },
  "mood.desc": { ru: "Песни с настроением «{m}» — по тегам ИИ.", en: "“{m}” songs, tagged by AI.", uz: "{m} kayfiyatdagi qo'shiqlar — AI teglari asosida." },
  "collection.empty": { ru: "Здесь пока нет песен", en: "No songs here yet", uz: "Bu yerda hali qo'shiq yo'q" },

  "artist.popular": { ru: "Популярные", en: "Popular", uz: "Mashhur" },
  "artist.all": { ru: "Все песни", en: "All songs", uz: "Barcha qo'shiqlar" },
  "artist.albums": { ru: "Альбомы и синглы", en: "Albums & singles", uz: "Albom va singllar" },
  "artist.similar": { ru: "Похожие исполнители", en: "Fans also like", uz: "O'xshash ijrochilar" },
  "artist.radio": { ru: "Радио исполнителя", en: "Artist radio", uz: "Ijrochi radiosi" },
  "artist.notFound": { ru: "Исполнитель не найден", en: "Artist not found", uz: "Ijrochi topilmadi" },
  "artist.onDeezer": { ru: "на Deezer", en: "on Deezer", uz: "Deezer'da" },
  "artist.links": { ru: "Официальные страницы", en: "Official pages", uz: "Rasmiy sahifalar" },

  "song.added": { ru: "Добавлено: {when}", en: "Added {when}", uz: "Qo'shilgan: {when}" },
  "song.found": { ru: "Определено: {src}", en: "Identified by {src}", uz: "Aniqlandi: {src}" },
  "song.confidence": { ru: "уверенность {n}%", en: "{n}% confidence", uz: "ishonch {n}%" },
  "song.similar": { ru: "Похожие песни", en: "Similar songs", uz: "O'xshash qo'shiqlar" },
  "song.energy": { ru: "Энергия", en: "Energy", uz: "Energiya" },
  "song.pending": { ru: "Песня добавляется…", en: "Adding the song…", uz: "Qo'shiq joylanmoqda…" },
  "song.pendingDesc": { ru: "Бот только что её добавил — сайт обновится через 1–3 минуты. Страница обновится сама.", en: "The bot just added it — the site updates in 1–3 minutes. This page refreshes by itself.", uz: "Bot uni hozirgina qo'shdi — sayt 1–3 daqiqada yangilanadi. Sahifa o'zi yangilanadi." },
  "song.notFound": { ru: "Песня не найдена", en: "Song not found", uz: "Qo'shiq topilmadi" },
  "song.notFoundDesc": { ru: "Возможно, она была удалена.", en: "It may have been removed.", uz: "U o'chirilgan bo'lishi mumkin." },
  "page.notFound": { ru: "Страница не найдена", en: "Page not found", uz: "Sahifa topilmadi" },
  "load.error": { ru: "Не удалось загрузить медиатеку", en: "Couldn't load the library", uz: "Kutubxonani yuklab bo'lmadi" },

  "dj.banner": { ru: "DJ — музыка по вашим словам", en: "DJ — music in your own words", uz: "DJ — o'z so'zlaringiz bilan musiqa" },
  "dj.bannerSub": { ru: "Напишите, что хотите послушать", en: "Say what you'd like to hear", uz: "Nima eshitmoqchi ekaningizni yozing" },
  "dj.hello": { ru: "Привет! Я DJ станции. Напишите по-узбекски, по-русски или по-английски, что хотите послушать — настроение, жанр, язык, исполнителя — и я подберу и включу.", en: "Hi! I'm the station's DJ. Tell me in Uzbek, Russian or English what you'd like — a mood, genre, language or artist — and I'll pick and play it.", uz: "Salom! Men stansiya DJ'iman. O'zbek, rus yoki ingliz tilida nima eshitmoqchi ekaningizni yozing — kayfiyat, janr, til yoki ijrochi — men tanlab, qo'yib beraman." },
  "dj.placeholder": { ru: "Например: грустные песни на русском", en: "e.g. upbeat English songs", uz: "Masalan: quvnoq o'zbekcha qo'shiqlar" },
  "dj.voice": { ru: "Сказать голосом", en: "Speak", uz: "Ovoz bilan aytish" },
  "dj.listening": { ru: "Слушаю…", en: "Listening…", uz: "Eshityapman…" },
  "dj.send": { ru: "Отправить", en: "Send", uz: "Yuborish" },
  "dj.playAll": { ru: ["Слушать все {n}", "Слушать все {n}", "Слушать все {n}"], en: ["Play all {n}", "Play all {n}"], uz: ["Hammasini tinglash ({n})"] },
  "np.showCover": { ru: "Обложка", en: "Cover", uz: "Muqova" },
  "np.showVideo": { ru: "Видео", en: "Video", uz: "Video" },
  "np.playing": { ru: "Сейчас играет", en: "Now playing", uz: "Ijro etilmoqda" },
  "np.expand": { ru: "Развернуть", en: "Expand", uz: "Kattalashtirish" },
  "np.about": { ru: "О песне", en: "About the song", uz: "Qo'shiq haqida" },
  "np.details": { ru: "Подробнее", en: "Details", uz: "Batafsil" },
  "np.queue": { ru: "Далее в очереди", en: "Next in queue", uz: "Navbatda" },
  "np.queueEmpty": { ru: "Очередь пуста — дальше зазвучат похожие песни", en: "Queue is empty — similar songs will keep playing", uz: "Navbat bo'sh — o'xshash qo'shiqlar avtomatik davom etadi" },
  "np.addedAgo": { ru: "добавлено {when}", en: "added {when}", uz: "{when} qo'shilgan" },
  "np.noLyrics": { ru: "Текст не найден", en: "No lyrics found", uz: "Qo'shiq matni topilmadi" },
  "queue.now": { ru: "Сейчас играет", en: "Now playing", uz: "Hozir ijroda" },
  "queue.yours": { ru: "Ваша очередь", en: "Your queue", uz: "Navbatingiz" },
  "queue.next": { ru: "Далее: {t}", en: "Next from: {t}", uz: "Keyingisi: {t}" },
  "queue.autoplay": { ru: "Потом включатся похожие песни ✨", en: "Similar songs will be added automatically ✨", uz: "Oxirida o'xshash qo'shiqlar avtomatik qo'shiladi ✨" },

  "ctx.radio": { ru: "Радио", en: "Radio", uz: "Radio" },
  "ctx.mix": { ru: "Микс", en: "Mix", uz: "Miks" },
  "ctx.artist": { ru: "Исполнитель", en: "Artist", uz: "Ijrochi" },
  "ctx.genre": { ru: "Жанр", en: "Genre", uz: "Janr" },
  "ctx.mood": { ru: "Настроение", en: "Mood", uz: "Kayfiyat" },
  "ctx.liked": { ru: "Любимые", en: "Liked Songs", uz: "Sevimlilar" },
  "ctx.search": { ru: "Поиск", en: "Search", uz: "Qidiruv" },
  "ctx.autoplay": { ru: "Автовоспроизведение", en: "Autoplay", uz: "Avtomatik davom" },
  "ctx.album": { ru: "Альбом", en: "Album", uz: "Albom" },
  "ctx.radioOf": { ru: "Радио: {t}", en: "{t} Radio", uz: "{t} radiosi" },

  "menu.addFav": { ru: "Добавить в любимые", en: "Add to Liked Songs", uz: "Sevimlilarga qo'shish" },
  "menu.removeFav": { ru: "Удалить из любимых", en: "Remove from Liked Songs", uz: "Sevimlilardan olib tashlash" },
  "menu.playNext": { ru: "Играть следующей", en: "Play next", uz: "Keyingisi bo'lib ijro etish" },
  "menu.addQueue": { ru: "Добавить в очередь", en: "Add to queue", uz: "Navbatga qo'shish" },
  "menu.radio": { ru: "Радио по песне", en: "Go to song radio", uz: "Qo'shiq radiosi" },
  "menu.artist": { ru: "Исполнитель: {a}", en: "Artist: {a}", uz: "Ijrochi: {a}" },
  "menu.about": { ru: "О песне", en: "Song info", uz: "Qo'shiq haqida" },

  "toast.faved": { ru: "Добавлено в любимые 💚", en: "Added to Liked Songs 💚", uz: "Sevimlilarga qo'shildi 💚" },
  "toast.unfaved": { ru: "Удалено из любимых", en: "Removed from Liked Songs", uz: "Sevimlilardan olib tashlandi" },
  "toast.playNext": { ru: "Будет играть следующей", en: "Will play next", uz: "Keyingi bo'lib qo'yildi" },
  "toast.queued": { ru: "Добавлено в очередь", en: "Added to queue", uz: "Navbatga qo'shildi" },
  "toast.shuffle": { ru: "Перемешано 🔀", en: "Shuffling 🔀", uz: "Aralash ijro 🔀" },
  "toast.copied": { ru: "Ссылка скопирована", en: "Link copied", uz: "Havola nusxalandi" },
  "toast.downloading": { ru: "Скачивание…", en: "Downloading…", uz: "Yuklab olinmoqda…" },
  "toast.newSong": { ru: "🎵 Новая песня: {s}", en: "🎵 New song: {s}", uz: "🎵 Yangi qo'shiq: {s}" },
  "toast.newSongs": { ru: "🎵 Новых песен: {n}", en: "🎵 {n} new songs added", uz: "🎵 {n} ta yangi qo'shiq qo'shildi" },
  "toast.failed": { ru: "«{t}» не воспроизводится — включаю следующую", en: "“{t}” couldn't play — skipping", uz: "«{t}» ochilmadi — keyingisiga o'tildi" },

  "time.now": { ru: "только что", en: "just now", uz: "hozirgina" },
  "time.min": { ru: "{n} мин назад", en: "{n} min ago", uz: "{n} daqiqa oldin" },
  "time.hour": { ru: "{n} ч назад", en: "{n} h ago", uz: "{n} soat oldin" },
  "time.day": { ru: "{n} дн назад", en: "{n} d ago", uz: "{n} kun oldin" },
  "dur.hm": { ru: "{h} ч {m} мин", en: "{h} hr {m} min", uz: "{h} soat {m} daq" },
  "dur.m": { ru: "{m} мин", en: "{m} min", uz: "{m} daq" },
  "dur.s": { ru: "{s} сек", en: "{s} sec", uz: "{s} soniya" },

  "lyrics.translate": { ru: "Перевод", en: "Translation", uz: "Tarjima" },
  "lyrics.share": { ru: "Поделиться строками", en: "Share lyrics", uz: "Qatorlarni ulashish" },
  "lyrics.pick": { ru: "Выберите до 4 строк", en: "Pick up to 4 lines", uz: "4 tagacha qator tanlang" },
  "lyrics.picked": { ru: "Выбрано: {n} из 4", en: "{n} of 4 selected", uz: "Tanlandi: {n} / 4" },
  "lyrics.max": { ru: "Можно выбрать не больше 4 строк", en: "You can pick up to 4 lines", uz: "Ko'pi bilan 4 ta qator tanlash mumkin" },
  "share.title": { ru: "Поделиться", en: "Share", uz: "Ulashish" },
  "share.story": { ru: "В сторис (Instagram, Telegram, WhatsApp…)", en: "To stories (Instagram, Telegram, WhatsApp…)", uz: "Stories'ga (Instagram, Telegram, WhatsApp…)" },
  "share.tgStory": { ru: "История в Telegram", en: "Telegram story", uz: "Telegram hikoyasi" },
  "share.save": { ru: "Сохранить картинку", en: "Save image", uz: "Rasmni saqlash" },
  "share.link": { ru: "Скопировать ссылку", en: "Copy link", uz: "Havolani nusxalash" },
  "share.linkAt": { ru: "Ссылка с {t}", en: "Link from {t}", uz: "{t} dan havola" },
  "share.telegram": { ru: "Отправить в Telegram", en: "Send via Telegram", uz: "Telegram'da yuborish" },
  "share.card": { ru: "Карточка для сторис", en: "Story card", uz: "Stories kartasi" },
  "share.lyricsCard": { ru: "Карточка с текстом", en: "Lyrics card", uz: "Matnli karta" },
  "share.making": { ru: "Готовим картинку…", en: "Making the image…", uz: "Rasm tayyorlanmoqda…" },
  "share.openBrowser": { ru: "Открыть в браузере (для Instagram)", en: "Open in browser (for Instagram)", uz: "Brauzerda ochish (Instagram uchun)" },
  "share.video": { ru: "Видео со звуком — для сторис", en: "Video with sound — for stories", uz: "Ovozli video — stories uchun" },
  "share.videoMaking": { ru: "Записываем видео… {n}%", en: "Recording the video… {n}%", uz: "Video yozilmoqda… {n}%" },
  "share.videoKeep": { ru: "Не закрывайте экран — видео пишется в реальном времени (до 15 сек)", en: "Keep this screen open — it records in real time (up to 15 s)", uz: "Ekranni yopmang — video real vaqtda yoziladi (15 soniyagacha)" },
  "share.shareVideo": { ru: "Поделиться видео", en: "Share the video", uz: "Videoni ulashish" },
  "share.saveVideo": { ru: "Сохранить видео", en: "Save the video", uz: "Videoni saqlash" },
  "share.videoFail": { ru: "На этом устройстве не получилось записать видео", en: "Couldn't record a video on this device", uz: "Bu qurilmada video yozib bo'lmadi" },
  "share.linkHint": { ru: "Ссылка на песню скопирована — в Instagram добавьте стикер «Ссылка» и вставьте её", en: "The song link is copied — in Instagram add the “Link” sticker and paste it", uz: "Qo'shiq havolasi nusxalandi — Instagram'da «Ссылка/Link» stikerini qo'shib, joylang" },
  "share.linkTip": { ru: "В Instagram текст на картинке не нажимается. Чтобы ссылка открывалась, добавьте стикер «Ссылка» — ссылка копируется автоматически, когда вы делитесь.", en: "Instagram never makes text in a picture tappable. For a working link add the “Link” sticker — the link is copied automatically when you share.", uz: "Instagram rasmdagi yozuvni bosiladigan qilmaydi. Havola ishlashi uchun «Ссылка/Link» stikerini qo'shing — ulashganingizda havola avtomatik nusxalanadi." },
  "share.igNote": { ru: "Instagram иногда отключает звук у песен, защищённых авторским правом — тогда добавьте музыку стикером «Музыка».", en: "Instagram sometimes mutes copyrighted songs — then add the song with its “Music” sticker.", uz: "Instagram ba'zan mualliflik huquqi bor qo'shiqlar ovozini o'chiradi — unda qo'shiqni «Музыка/Music» stikeri bilan qo'shing." },
  "song.playFrom": { ru: "Слушать с {t}", en: "Play from {t}", uz: "{t} dan tinglash" },

  "add.title": { ru: "Добавить музыку", en: "Add music", uz: "Musiqa qo'shish" },
  "add.sub": { ru: "Песни добавляются только файлом — через бота @{bot}. Всё остальное он сделает сам.", en: "Songs are added only as files — via @{bot}. It does everything else by itself.", uz: "Qo'shiqlar faqat fayl orqali qo'shiladi — @{bot} orqali. Qolganini bot o'zi qiladi." },
  "add.step1": { ru: "Отправьте боту аудиофайл или перешлите его из любого чата или канала", en: "Send the bot an audio file or forward one from any chat or channel", uz: "Botga audio fayl yuboring yoki istalgan chat yoki kanaldan forward qiling" },
  "add.step2": { ru: "Бот сам определит название, исполнителя, обложку, жанр, настроение и текст", en: "The bot detects the title, artist, cover, genre, mood and lyrics by itself", uz: "Bot nomi, ijrochisi, muqovasi, janri, kayfiyati va matnini o'zi aniqlaydi" },
  "add.step3": { ru: "Через несколько минут песня появится здесь", en: "A few minutes later the song shows up here", uz: "Bir necha daqiqadan so'ng qo'shiq shu yerda paydo bo'ladi" },
  "add.formats": { ru: "MP3, M4A, FLAC, OGG, WAV или видеоклип — до 20 МБ", en: "MP3, M4A, FLAC, OGG, WAV or a video clip — up to 20 MB", uz: "MP3, M4A, FLAC, OGG, WAV yoki video klip — 20 MB gacha" },
  "add.openBot": { ru: "Открыть бота", en: "Open the bot", uz: "Botni ochish" },
  "add.ownerOnly": { ru: "Добавлять музыку может только владелец станции", en: "Only the station owner can add music", uz: "Musiqani faqat stansiya egasi qo'sha oladi" },
  "add.ownerOnlyDesc": { ru: "А слушать можно всё — без ограничений.", en: "Listening is open to everyone.", uz: "Tinglash esa hamma uchun ochiq." },

  "vi.why": { ru: "Почему есть отметка", en: "Why this badge", uz: "Belgi nega berilgan" },
  "vi.intro": { ru: "{app} ставит синюю отметку, только когда исполнителя подтверждают официальные музыкальные сервисы. Значит, это настоящий артист, а не однофамилец или фейк.", en: "{app} shows the blue badge only when official music services confirm the artist. It means this is the real artist, not a namesake or a fake.", uz: "{app} ko'k belgini faqat rasmiy musiqa servislari ijrochini tasdiqlagandagina beradi. Demak, bu haqiqiy ijrochi — adash yoki soxta emas." },
  "vi.deezer": { ru: "Официальная страница артиста на Deezer", en: "Official artist page on Deezer", uz: "Deezer'dagi rasmiy ijrochi sahifasi" },
  "vi.apple": { ru: "Официальная страница артиста в Apple Music", en: "Official artist page on Apple Music", uz: "Apple Music'dagi rasmiy ijrochi sahifasi" },
  "vi.match": { ru: "Песни на станции совпадают с его официальными релизами", en: "Songs on the station match the artist's official releases", uz: "Stansiyadagi qo'shiqlar uning rasmiy relizlari bilan mos keladi" },
  "vi.owner": { ru: "Подтверждено владельцем станции", en: "Confirmed by the station owner", uz: "Stansiya egasi tomonidan tasdiqlangan" },
  "vi.since": { ru: "Отметка получена: {date}", en: "Verified on {date}", uz: "Tasdiqlangan sana: {date}" },
  "vi.songs": { ru: "песен на {app}", en: "songs on {app}", uz: "{app}'dagi qo'shiqlar" },
  "vi.plays": { ru: "ваших прослушиваний", en: "your plays", uz: "sizning tinglashlaringiz" },
  "vi.fans": { ru: "подписчиков в Deezer", en: "fans on Deezer", uz: "Deezer'dagi muxlislar" },
  "vi.albums": { ru: "релизов в Deezer", en: "releases on Deezer", uz: "Deezer'dagi relizlar" },
  "vi.about": { ru: "Об исполнителе", en: "About", uz: "Ijrochi haqida" },
  "vi.source": { ru: "Источник: Википедия", en: "Source: Wikipedia", uz: "Manba: Vikipediya" },
  "vi.translated": { ru: "автоматический перевод", en: "machine-translated", uz: "avtomatik tarjima" },
  "vi.open": { ru: "Открыть профиль", en: "Open profile", uz: "Profilni ochish" },

  "settings.title": { ru: "Настройки", en: "Settings", uz: "Sozlamalar" },
  "settings.language": { ru: "Язык сайта", en: "Site language", uz: "Sayt tili" },
  "settings.about": { ru: "Музыку добавляет владелец станции через бота", en: "Music is added by the station owner via the bot", uz: "Musiqani stansiya egasi bot orqali qo'shadi" },
  "footer": { ru: "{n} на станции", en: "{n} on the station", uz: "Stansiyada {n}" },
};

function pluralIndex(n) {
  if (LANG === "ru") {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 2;
    if (b === 1) return 0;
    if (b >= 2 && b <= 4) return 1;
    return 2;
  }
  if (LANG === "en") return n === 1 ? 0 : 1;
  return 0;
}

export function t(key, vars = {}) {
  const entry = S[key];
  if (!entry) return key;
  let s = entry[LANG] ?? entry.en ?? entry.ru;
  if (Array.isArray(s)) s = s[Math.min(s.length - 1, pluralIndex(vars.n ?? 0))];
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? (k === "n" ? fmtNum(vars[k]) : vars[k]) : ""));
}

export let LOCALE = LANG === "uz" ? "uz-UZ" : LANG === "ru" ? "ru-RU" : "en-US";
window.addEventListener("app:lang", () => { LOCALE = LANG === "uz" ? "uz-UZ" : LANG === "ru" ? "ru-RU" : "en-US"; });

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
/** "29 сентября 2026 г." / "September 29, 2026" / "2026-yil 29-sentabr" (browsers lack Uzbek month names). */
export function fmtDate(d) {
  if (LANG === "uz") return `${d.getFullYear()}-yil ${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
}

export function fmtDateShort(d) {
  if (LANG === "uz") return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

/** 15 481 654 -> "15 млн" / "15M" */
export function fmtCompact(n) {
  return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
}

export function fmtNum(n) {
  return new Intl.NumberFormat(LANG === "uz" ? "uz-UZ" : LANG === "ru" ? "ru-RU" : "en-US").format(n || 0);
}

// ------------------------------------------------------------------ genres / moods / languages
const L = (ru, en, uz) => ({ ru, en, uz });
export const GENRES = {
  "Pop": { l: L("Поп", "Pop", "Pop"), color: "#8d67ab", emoji: "🎤" },
  "Estrada": { l: L("Эстрада", "Estrada", "Estrada"), color: "#e8115b", emoji: "🌟" },
  "Hip-Hop": { l: L("Хип-хоп / Рэп", "Hip-Hop / Rap", "Hip-hop / Rep"), color: "#ba5d07", emoji: "🎧" },
  "R&B": { l: L("R&B", "R&B", "R&B"), color: "#dc148c", emoji: "💜" },
  "Rock": { l: L("Рок", "Rock", "Rok"), color: "#e61e32", emoji: "🎸" },
  "Electronic": { l: L("Электроника", "Electronic", "Elektron"), color: "#0d73ec", emoji: "🎛️" },
  "Dance": { l: L("Танцевальная", "Dance", "Raqs"), color: "#d84000", emoji: "💃" },
  "Folk": { l: L("Народная", "Folk & Traditional", "Xalq / An'anaviy"), color: "#148a08", emoji: "🪕" },
  "Classical": { l: L("Классика", "Classical", "Klassik"), color: "#7d4b32", emoji: "🎻" },
  "Jazz": { l: L("Джаз", "Jazz", "Jaz"), color: "#1e3264", emoji: "🎷" },
  "Lo-fi": { l: L("Lo-fi / Чилл", "Lo-fi / Chill", "Lo-fi / Chill"), color: "#477d95", emoji: "☕" },
  "Indie": { l: L("Инди", "Indie", "Indi"), color: "#608108", emoji: "🌿" },
  "Metal": { l: L("Метал", "Metal", "Metal"), color: "#503750", emoji: "🤘" },
  "Latin": { l: L("Латино", "Latin", "Lotin"), color: "#e1118b", emoji: "🌶️" },
  "K-Pop": { l: L("K-Pop", "K-Pop", "K-Pop"), color: "#148a08", emoji: "✨" },
  "Soundtrack": { l: L("Саундтреки", "Soundtrack", "Saundtrek"), color: "#509bf5", emoji: "🎬" },
  "Religious": { l: L("Духовная", "Spiritual", "Ma'naviy"), color: "#8c1932", emoji: "🕊️" },
  "Children": { l: L("Детская", "Kids", "Bolalar"), color: "#f59b23", emoji: "🧸" },
  "Other": { l: L("Другое", "Other", "Boshqa"), color: "#535353", emoji: "🎶" },
};

export const MOODS = {
  happy: { l: L("Весёлое", "Happy", "Quvnoq"), color: "#f59b23", emoji: "😊" },
  sad: { l: L("Грустное", "Sad", "G'amgin"), color: "#1e3264", emoji: "🌧️" },
  romantic: { l: L("Романтика", "Romantic", "Romantik"), color: "#e13300", emoji: "❤️" },
  energetic: { l: L("Энергичное", "Energetic", "Energik"), color: "#e8115b", emoji: "⚡" },
  calm: { l: L("Спокойное", "Calm", "Sokin"), color: "#477d95", emoji: "🌙" },
  party: { l: L("Вечеринка", "Party", "Bazm"), color: "#af2896", emoji: "🎉" },
  melancholic: { l: L("Меланхолия", "Melancholic", "Melanxolik"), color: "#503750", emoji: "🍂" },
  motivational: { l: L("Мотивация", "Motivation", "Ruhlantiruvchi"), color: "#148a08", emoji: "🔥" },
  nostalgic: { l: L("Ностальгия", "Nostalgic", "Nostalgik"), color: "#7d4b32", emoji: "📼" },
  dark: { l: L("Мрачное", "Dark", "Qorong'i"), color: "#2d2d2d", emoji: "🖤" },
  dreamy: { l: L("Мечтательное", "Dreamy", "Xayolchan"), color: "#8d67ab", emoji: "☁️" },
  angry: { l: L("Яростное", "Intense", "Shiddatli"), color: "#ba1c1c", emoji: "💥" },
};

export const LANGS = {
  uz: L("Узбекский", "Uzbek", "O'zbekcha"), ru: L("Русский", "Russian", "Ruscha"), en: L("Английский", "English", "Inglizcha"),
  tr: L("Турецкий", "Turkish", "Turkcha"), kk: L("Казахский", "Kazakh", "Qozoqcha"), ky: L("Киргизский", "Kyrgyz", "Qirg'izcha"),
  tg: L("Таджикский", "Tajik", "Tojikcha"), az: L("Азербайджанский", "Azerbaijani", "Ozarbayjoncha"),
  fa: L("Персидский", "Persian", "Forscha"), ar: L("Арабский", "Arabic", "Arabcha"), hi: L("Хинди", "Hindi", "Hindcha"),
  ko: L("Корейский", "Korean", "Koreyscha"), es: L("Испанский", "Spanish", "Ispancha"), fr: L("Французский", "French", "Fransuzcha"),
  de: L("Немецкий", "German", "Nemischa"), it: L("Итальянский", "Italian", "Italyancha"), other: L("Другой", "Other", "Boshqa"),
  instrumental: L("Инструментал", "Instrumental", "Instrumental"),
};

export const genre = (g) => {
  const x = GENRES[g] || GENRES.Other;
  return { ...x, label: x.l[LANG] };
};
export const mood = (m) => {
  const x = MOODS[m];
  return x ? { ...x, label: x.l[LANG] } : { l: {}, label: m, color: "#535353", emoji: "🎵" };
};
export const lang = (l) => (LANGS[l] ? LANGS[l][LANG] : l || "—");

/** The song's AI description in the site language (older songs have a plain Uzbek string). */
export function describe(s) {
  const d = s?.description;
  if (!d) return "";
  if (typeof d === "string") return LANG === "uz" ? d : "";
  return d[LANG] || d.en || d.ru || d.uz || "";
}
