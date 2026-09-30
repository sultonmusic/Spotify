// DJ: ask for music in your own words (Uzbek, Russian or English) and it picks and plays songs from
// the station. The request is read for mood, genre, language, artist, tempo, era, "new", "liked", "top"
// and a number of songs; the choice is then ranked with the listener's own taste (reco.js).
import { lib, favSongs, plays } from "./store.js";
import { norm, searchSongs } from "./search.js";
import { GENRES, MOODS, LANGS, LANG } from "./i18n.js";
import * as reco from "./reco.js";

// ------------------------------------------------------------------ vocabulary (stems; Cyrillic is transliterated by norm)
const MOOD_WORDS = {
  happy: ["quvnoq", "xursand", "shod", "kulgi", "yaxshi kayfiyat", "весел", "радост", "позитив", "счастл", "happy", "cheer", "joy", "upbeat", "fun", "feel good"],
  sad: ["gamgin", "qaygu", "xafa", "yigla", "ayrilik", "грустн", "грусть", "печал", "тоск", "плак", "sad", "cry", "heartbreak", "broken"],
  romantic: ["romantik", "sevgi", "muhabbat", "ishq", "yorim", "любов", "романт", "влюб", "love", "romantic"],
  energetic: ["energ", "gayrat", "shijoat", "sport", "mashq", "бодр", "энерг", "трениров", "workout", "gym", "hype", "pump"],
  calm: ["sokin", "tinch", "osoyishta", "dam ol", "uyqu", "спокой", "тих", "расслаб", "calm", "chill", "relax", "sleep", "soft"],
  party: ["bazm", "toy", "raqs", "дискот", "вечерин", "тусов", "танц", "party", "dance", "disco", "club", "klub"],
  melancholic: ["melanxol", "меланхол", "melanchol"],
  motivational: ["motivats", "ruhlan", "ilhom", "мотивац", "вдохнов", "motivat", "inspir"],
  nostalgic: ["nostalg", "sogin", "ностальг", "retro", "ретро", "old school", "oldschool"],
  dark: ["qorongi", "мрачн", "dark", "gloomy"],
  dreamy: ["xayol", "мечт", "dream", "ethereal"],
  angry: ["jahl", "gazab", "агресс", "ярост", "злост", "angry", "rage", "aggressive"],
};
const GENRE_WORDS = {
  "Pop": ["pop", "поп"],
  "Estrada": ["estrada", "эстрад"],
  "Hip-Hop": ["rap", "rep", "рэп", "реп", "hip hop", "hiphop", "хип хоп", "xip xop"],
  "R&B": ["rnb", "r n b", "r and b"],
  "Rock": ["rock", "rok", "рок"],
  "Electronic": ["electr", "elektr", "электр", "edm", "techno", "tekno", "техно", "house"],
  "Folk": ["folk", "xalq", "народн", "milliy", "maqom", "anaviy"],
  "Classical": ["classic", "klassik", "классик", "opera", "опер"],
  "Jazz": ["jazz", "jaz", "джаз"],
  "Lo-fi": ["lofi", "lo fi", "лофай"],
  "Indie": ["indie", "indi", "инди"],
  "Metal": ["metal", "метал"],
  "Latin": ["latin", "lotin", "латин", "reggaeton"],
  "K-Pop": ["kpop", "k pop", "кей поп"],
  "Soundtrack": ["soundtrack", "саундтрек", "ost", "kino", "фильм", "film", "serial"],
  "Religious": ["nasheed", "nashid", "нашид", "ilohiy", "manaviy", "духовн"],
  "Children": ["bolalar", "детск", "kids", "children", "multfilm"],
};
const LANG_WORDS = {
  uz: ["uzbek", "ozbek", "узбек"],
  ru: ["rus", "русск", "russian", "по русски"],
  en: ["english", "ingliz", "англ"],
  tr: ["turk", "турец", "turkish"],
  ar: ["arab", "араб"],
  kk: ["qozoq", "казах", "kazakh"],
  ky: ["qirgiz", "кирги", "kyrgyz"],
  tg: ["tojik", "таджик", "tajik"],
  az: ["ozarbayjon", "азербайдж", "azerbaijan", "azeri"],
  ko: ["koreys", "корейск", "korean"],
  hi: ["hind", "хинди", "hindi", "bollywood"],
  es: ["ispan", "испан", "spanish"],
  fr: ["fransuz", "француз", "french"],
  de: ["nemis", "немец", "german"],
  fa: ["fors", "перси", "persian", "farsi"],
};
const SLOW = ["sekin", "медлен", "slow"];
const FAST = ["tez", "быстр", "fast"];
const NEW = ["yangi", "songgi", "новые", "новое", "новинк", "свеж", "new", "latest", "fresh"];
const LIKED = ["sevimli", "yoqtirgan", "любим", "избран", "liked", "favorite", "favourite"];
const TOP = ["top", "mashhur", "eng kop", "популяр", "хит", "hit", "popular", "most played", "trend"];
const OLD = ["eski", "старые", "старое", "стар", "old"];
const SIMILAR = ["kabi", "oxshash", "похож", "как у", "like", "similar"];

const prep = (list) => list.map(norm).filter(Boolean);
const V = {
  mood: Object.fromEntries(Object.entries(MOOD_WORDS).map(([k, v]) => [k, prep(v)])),
  genre: Object.fromEntries(Object.entries(GENRE_WORDS).map(([k, v]) => [k, prep(v)])),
  lang: Object.fromEntries(Object.entries(LANG_WORDS).map(([k, v]) => [k, prep(v)])),
  slow: prep(SLOW), fast: prep(FAST), fresh: prep(NEW), liked: prep(LIKED), top: prep(TOP), old: prep(OLD), similar: prep(SIMILAR),
};

/** Same beginning with at most one wrong letter ("ramantik" ~ "romantik"). */
function nearPrefix(word, stem) {
  if (stem.length < 5 || word.length < stem.length) return false;
  let diff = 0;
  for (let i = 0; i < stem.length; i++) if (word[i] !== stem[i] && ++diff > 1) return false;
  return true;
}

/** A stem matches a word that starts with it (one typo allowed in long stems); a phrase matches anywhere. */
function has(q, words, stems) {
  return stems.some((st) => (st.includes(" ")
    ? ` ${q} `.includes(` ${st}`)
    : words.some((w) => (w.startsWith(st) && (st.length >= 4 || w.length <= st.length + 3)) || nearPrefix(w, st))));
}

/** Which language the listener is writing in (the DJ answers in it). */
function replyLang(text) {
  if (/[ўқғҳ]/i.test(text)) return "uz";
  if (/[а-яё]/i.test(text)) return "ru";
  const q = ` ${norm(text)} `;
  if (/ (qoshiq|menga|uchun|kerak|qoy|ber|yoq|bor|ozbek|musiqa|eshit|quvnoq|gamgin|sevimli|yangi|sekin|tez|romantik|ta )\w*/.test(q)) return "uz";
  if (/ (play|song|songs|music|some|something|me|for|with|the|and|please|want) /.test(q)) return "en";
  return LANG;
}

// ------------------------------------------------------------------ understanding
export function understand(text) {
  const q = norm(text);
  const words = q.split(" ").filter(Boolean);
  const pick = (dict) => new Set(Object.keys(dict).filter((k) => has(q, words, dict[k])));
  const intent = {
    text, q, reply: replyLang(text),
    moods: pick(V.mood), genres: pick(V.genre), langs: pick(V.lang),
    energy: has(q, words, V.slow) ? "low" : has(q, words, V.fast) ? "high" : null,
    fresh: has(q, words, V.fresh), liked: has(q, words, V.liked), top: has(q, words, V.top),
    similar: has(q, words, V.similar), artists: [], years: null, limit: 25,
  };
  // artists named in the request: the whole name, or a distinctive part of it ("eilish", "sevara")
  for (const name of lib.byArtist.keys()) {
    const n = norm(name);
    if (n.length >= 3 && ` ${q} `.includes(` ${n} `)) intent.artists.push(name);
    else if (n.split(" ").some((part) => part.length >= 5 && words.includes(part))) intent.artists.push(name);
  }
  // years / decades: "2015", "90s", "90-х", "90-yillar", "2000s"
  const decade = /\b(19\d0|20\d0|[5-9]0|00|10)\s*(s|x|h|lar|yillar|e|y)\b/.exec(q);
  const year = /\b(19[5-9]\d|20[0-3]\d)\b/.exec(q);
  if (decade) {
    let d = +decade[1];
    if (d < 100) d += d >= 50 ? 1900 : 2000;
    intent.years = [d, d + 9];
  } else if (year) intent.years = [+year[1], +year[1]];
  else if (has(q, words, V.old)) intent.years = [0, 2012];
  const count = /\b(\d{1,2})\s*(ta|dona|pesn|pesen|pesni|trek|song|track)/.exec(q);
  if (count) intent.limit = Math.max(3, Math.min(50, +count[1]));
  intent.any = intent.moods.size || intent.genres.size || intent.langs.size || intent.energy || intent.fresh
    || intent.liked || intent.top || intent.artists.length || intent.years;
  return intent;
}

const LOW_MOODS = new Set(["sad", "calm", "melancholic", "dreamy", "romantic"]);
const HIGH_MOODS = new Set(["energetic", "party", "happy", "motivational", "angry"]);

/** Songs for the request, best first. */
export function choose(intent) {
  const byArtist = (list) => new Set(list.flatMap((a) => lib.byArtist.get(a) || []).map((s) => s.id));
  let pool = intent.liked ? favSongs() : lib.songs.slice();
  if (intent.artists.length) {
    const names = intent.similar ? [...intent.artists, ...intent.artists.flatMap((a) => reco.similarArtists(a, 8))] : intent.artists;
    const ids = byArtist(names);
    pool = pool.filter((s) => ids.has(s.id));
  }
  if (intent.langs.size) pool = pool.filter((s) => intent.langs.has(s.language));
  if (intent.genres.size) pool = pool.filter((s) => intent.genres.has(s.genre));
  if (intent.years) pool = pool.filter((s) => s.year && s.year >= intent.years[0] && s.year <= intent.years[1]);
  if (!pool.length) return [];

  // moods and tempo are preferences: keep the matching songs when there are enough of them
  const moodHit = (s) => (s.moods || []).filter((m) => intent.moods.has(m)).length;
  const wantLow = intent.energy === "low" || [...intent.moods].some((m) => LOW_MOODS.has(m));
  const wantHigh = intent.energy === "high" || [...intent.moods].some((m) => HIGH_MOODS.has(m));
  const energyFit = (s) => {
    const e = s.energy ?? 0.5;
    return wantLow && !wantHigh ? 1 - e : wantHigh && !wantLow ? e : 0.5;
  };
  if (intent.moods.size) {
    const matching = pool.filter((s) => moodHit(s));
    if (matching.length >= Math.min(3, pool.length)) pool = matching;
  }
  if (intent.energy) {
    const fit = pool.filter((s) => (intent.energy === "low" ? (s.energy ?? 0.5) <= 0.5 : (s.energy ?? 0.5) >= 0.55));
    if (fit.length >= Math.min(3, pool.length)) pool = fit;
  }

  if (intent.fresh) return pool.sort((a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0)).slice(0, intent.limit);
  if (intent.top) return pool.sort((a, b) => plays(b.id) - plays(a.id) || (b._plays || 0) - (a._plays || 0)).slice(0, intent.limit);
  const p = reco.profile();
  const ranked = pool.map((s) => ({ s, sc: reco.score(s, p, { explore: 0.15 }) + 0.35 * moodHit(s) + 0.25 * energyFit(s) }))
    .sort((a, b) => b.sc - a.sc);
  return intent.artists.length && !intent.similar ? ranked.map((x) => x.s).slice(0, intent.limit) : reco.diversify(ranked, intent.limit);
}

// ------------------------------------------------------------------ answering
const plural = (lang, n) => {
  if (lang === "ru") {
    const a = n % 100, b = n % 10;
    return `${n} ${a > 10 && a < 20 ? "песен" : b === 1 ? "песню" : b >= 2 && b <= 4 ? "песни" : "песен"}`;
  }
  if (lang === "en") return `${n} song${n === 1 ? "" : "s"}`;
  return `${n} ta qo'shiq`;
};

function facets(intent, lang) {
  const out = [];
  for (const m of intent.moods) out.push(MOODS[m]?.l[lang]?.toLowerCase());
  for (const g of intent.genres) out.push(GENRES[g]?.l[lang]);
  for (const l of intent.langs) out.push(LANGS[l]?.[lang]?.toLowerCase());
  if (intent.energy) out.push({ uz: intent.energy === "low" ? "sekin" : "tez", ru: intent.energy === "low" ? "медленные" : "быстрые", en: intent.energy === "low" ? "slow" : "fast" }[lang]);
  if (intent.years) out.push(intent.years[0] ? (intent.years[0] === intent.years[1] ? `${intent.years[0]}` : `${intent.years[0]}–${intent.years[1]}`) : { uz: "eski", ru: "старые", en: "older" }[lang]);
  if (intent.fresh) out.push({ uz: "yangi", ru: "новые", en: "newest" }[lang]);
  if (intent.liked) out.push({ uz: "sevimlilaringizdan", ru: "из любимых", en: "from your likes" }[lang]);
  if (intent.top) out.push({ uz: "eng ko'p tinglangan", ru: "самые популярные", en: "most played" }[lang]);
  if (intent.artists.length) out.push((intent.similar ? { uz: "shunga o'xshash: ", ru: "в духе ", en: "like " }[lang] : "") + intent.artists.join(", "));
  return out.filter(Boolean);
}

/** Understands the request, picks songs and writes the DJ's answer. */
export function ask(text) {
  const intent = understand(text);
  const lang = intent.reply;
  let songs = intent.any ? choose(intent) : [];
  let mode = "match";
  let missing = "";
  if (!songs.length && intent.any) {
    // Nothing fits everything: loosen the request step by step and say what's missing.
    for (const key of ["langs", "genres", "years", "artists"]) {
      const empty = key === "years" ? null : key === "artists" ? [] : new Set();
      const looser = { ...intent, [key]: empty };
      if (key === "artists") looser.similar = false;
      const alt = choose(looser);
      if (alt.length) {
        missing = facets({ ...intent, moods: new Set(), energy: null, fresh: false, liked: false, top: false,
          ...Object.fromEntries(["langs", "genres", "years", "artists"].filter((k) => k !== key).map((k) => [k, k === "years" ? null : k === "artists" ? [] : new Set()])) }, lang).join(", ");
        Object.assign(intent, looser);
        songs = alt;
        mode = "looser";
        break;
      }
    }
  }
  if (!intent.any) {
    songs = searchSongs(lib.songs, text).slice(0, 25);
    mode = songs.length ? "search" : "mix";
    if (!songs.length) songs = reco.forYou(25);
  }
  const f = facets(intent, lang);
  const desc = f.length ? ` — ${f.join(", ")}` : "";
  const lines = {
    match: { uz: `🎧 ${plural(lang, songs.length)} tanladim${desc}. Boshladik!`, ru: `🎧 Подобрал ${plural(lang, songs.length)}${desc}. Включаю!`, en: `🎧 Picked ${plural(lang, songs.length)}${desc}. Here we go!` },
    looser: { uz: `🤏 «${missing}» bo'yicha stansiyada hozircha qo'shiq yo'q, lekin mana ${plural(lang, songs.length)}${desc}. Boshladik!`, ru: `🤏 «${missing}» на станции пока нет, но вот ${plural(lang, songs.length)}${desc}. Включаю!`, en: `🤏 Nothing “${missing}” on the station yet, but here are ${plural(lang, songs.length)}${desc}. Here we go!` },
    search: { uz: `🔎 «${text}» bo'yicha ${plural(lang, songs.length)} topdim. Qo'yyapman!`, ru: `🔎 По запросу «${text}» нашёл ${plural(lang, songs.length)}. Включаю!`, en: `🔎 Found ${plural(lang, songs.length)} for “${text}”. Playing!` },
    mix: { uz: "✨ Aniq tushunmadim, lekin didingizga mos miks tayyorladim.", ru: "✨ Не совсем понял, но собрал микс под ваш вкус.", en: "✨ Not sure what you meant, so here's a mix for your taste." },
    none: { uz: "😕 Stansiyada bunday qo'shiq topilmadi. Boshqacha so'rab ko'ring — masalan: «quvnoq o'zbekcha qo'shiqlar».", ru: "😕 Такого на станции не нашлось. Попробуйте иначе — например: «грустные песни на русском».", en: "😕 Nothing like that on the station yet. Try something like “upbeat English songs”." },
  };
  const key = songs.length ? mode : "none";
  return { intent, songs, lang, text: lines[key][lang] || lines[key].en };
}

export const SUGGESTIONS = {
  uz: ["Quvnoq o'zbekcha qo'shiqlar", "Sport uchun energik musiqa", "Yangi qo'shiqlar", "Romantik inglizcha", "Sokin musiqa dam olish uchun"],
  ru: ["Грустные песни на русском", "Что-то энергичное для спорта", "Новинки", "Романтика на узбекском", "Спокойная музыка для отдыха"],
  en: ["Upbeat English songs", "Something energetic for the gym", "Newest songs", "Romantic Uzbek songs", "Calm music to relax"],
};
