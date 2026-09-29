// Uzbek labels for the canonical genre / mood / language values written by the bot.
export const GENRES = {
  "Pop": { label: "Pop", color: "#8d67ab", emoji: "🎤" },
  "Estrada": { label: "Estrada", color: "#e8115b", emoji: "🌟" },
  "Hip-Hop": { label: "Hip-hop / Rep", color: "#ba5d07", emoji: "🎧" },
  "R&B": { label: "R&B", color: "#dc148c", emoji: "💜" },
  "Rock": { label: "Rok", color: "#e61e32", emoji: "🎸" },
  "Electronic": { label: "Elektron", color: "#0d73ec", emoji: "🎛️" },
  "Dance": { label: "Raqs", color: "#d84000", emoji: "💃" },
  "Folk": { label: "Xalq / An'anaviy", color: "#148a08", emoji: "🪕" },
  "Classical": { label: "Klassik", color: "#7d4b32", emoji: "🎻" },
  "Jazz": { label: "Jaz", color: "#1e3264", emoji: "🎷" },
  "Lo-fi": { label: "Lo-fi / Chill", color: "#477d95", emoji: "☕" },
  "Indie": { label: "Indi", color: "#608108", emoji: "🌿" },
  "Metal": { label: "Metal", color: "#503750", emoji: "🤘" },
  "Latin": { label: "Lotin", color: "#e1118b", emoji: "🌶️" },
  "K-Pop": { label: "K-Pop", color: "#148a08", emoji: "✨" },
  "Soundtrack": { label: "Saundtrek", color: "#509bf5", emoji: "🎬" },
  "Religious": { label: "Ma'naviy", color: "#8c1932", emoji: "🕊️" },
  "Children": { label: "Bolalar", color: "#f59b23", emoji: "🧸" },
  "Other": { label: "Boshqa", color: "#535353", emoji: "🎶" },
};

export const MOODS = {
  happy: { label: "Quvnoq", color: "#f59b23", emoji: "😊" },
  sad: { label: "G'amgin", color: "#1e3264", emoji: "🌧️" },
  romantic: { label: "Romantik", color: "#e13300", emoji: "❤️" },
  energetic: { label: "Energik", color: "#e8115b", emoji: "⚡" },
  calm: { label: "Sokin", color: "#477d95", emoji: "🌙" },
  party: { label: "Bazm", color: "#af2896", emoji: "🎉" },
  melancholic: { label: "Melanxolik", color: "#503750", emoji: "🍂" },
  motivational: { label: "Ruhlantiruvchi", color: "#148a08", emoji: "🔥" },
  nostalgic: { label: "Nostalgik", color: "#7d4b32", emoji: "📼" },
  dark: { label: "Qorong'i", color: "#2d2d2d", emoji: "🖤" },
  dreamy: { label: "Xayolchan", color: "#8d67ab", emoji: "☁️" },
  angry: { label: "Shiddatli", color: "#ba1c1c", emoji: "💥" },
};

export const LANGS = {
  uz: "O'zbekcha", ru: "Ruscha", en: "Inglizcha", tr: "Turkcha", kk: "Qozoqcha", ky: "Qirg'izcha",
  tg: "Tojikcha", az: "Ozarbayjoncha", fa: "Forscha", ar: "Arabcha", hi: "Hindcha", ko: "Koreyscha",
  es: "Ispancha", fr: "Fransuzcha", de: "Nemischa", it: "Italyancha", other: "Boshqa", instrumental: "Instrumental",
};

export const genre = (g) => GENRES[g] || GENRES.Other;
export const mood = (m) => MOODS[m] || { label: m, color: "#535353", emoji: "🎵" };
export const lang = (l) => LANGS[l] || l || "—";
