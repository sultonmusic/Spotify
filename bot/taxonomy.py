"""Canonical genres/moods/languages shared by the bot, the AI prompt and the website."""
from __future__ import annotations

import re

GENRES = [
    "Pop", "Estrada", "Hip-Hop", "R&B", "Rock", "Electronic", "Dance", "Folk", "Classical",
    "Jazz", "Lo-fi", "Indie", "Metal", "Latin", "K-Pop", "Soundtrack", "Religious", "Children", "Other",
]

MOODS = [
    "happy", "sad", "romantic", "energetic", "calm", "party", "melancholic",
    "motivational", "nostalgic", "dark", "dreamy", "angry",
]

LANGUAGES = [
    "uz", "ru", "en", "tr", "kk", "ky", "tg", "az", "fa", "ar", "hi", "ko", "es", "fr", "de", "it", "other", "instrumental",
]

_GENRE_RULES = [
    (r"hip.?hop|rap|trap|drill|grime", "Hip-Hop"),
    (r"r&b|rnb|soul|funk", "R&B"),
    (r"k-?pop", "K-Pop"),
    (r"metal|hardcore", "Metal"),
    (r"punk|rock|grunge", "Rock"),
    (r"lo.?fi|chill|ambient|downtempo", "Lo-fi"),
    (r"house|techno|trance|edm|electro|dubstep|drum|bass|synth", "Electronic"),
    (r"dance|disco|club", "Dance"),
    (r"indie|alternative|\balt\b", "Indie"),
    (r"classical|orchestra|opera|piano", "Classical"),
    (r"jazz|blues|swing", "Jazz"),
    (r"latin|reggaeton|salsa|bachata", "Latin"),
    (r"soundtrack|film|movie|score|anime|game", "Soundtrack"),
    (r"folk|traditional|world|maqom|xalq|halq|ethnic|asian|arabic|turkish|worldwide", "Folk"),
    (r"estrada|эстрада|chanson|шансон|russian pop|uzbek pop|central asia", "Estrada"),
    (r"relig|gospel|christian|nasheed|islamic|spiritual", "Religious"),
    (r"child|kid|nursery", "Children"),
    (r"pop|singer|songwriter|vocal", "Pop"),
]

# Default moods and energy for a genre when nothing better is known.
GENRE_PROFILE = {
    "Pop": (["happy", "romantic"], 0.65), "Estrada": (["romantic", "nostalgic"], 0.6),
    "Hip-Hop": (["energetic", "motivational"], 0.75), "R&B": (["romantic", "dreamy"], 0.5),
    "Rock": (["energetic", "angry"], 0.8), "Electronic": (["energetic", "party"], 0.85),
    "Dance": (["party", "happy"], 0.9), "Folk": (["nostalgic", "calm"], 0.45),
    "Classical": (["calm", "dreamy"], 0.25), "Jazz": (["calm", "romantic"], 0.4),
    "Lo-fi": (["calm", "dreamy"], 0.25), "Indie": (["dreamy", "melancholic"], 0.5),
    "Metal": (["angry", "dark"], 0.95), "Latin": (["party", "romantic"], 0.8),
    "K-Pop": (["happy", "energetic"], 0.8), "Soundtrack": (["dreamy", "calm"], 0.4),
    "Religious": (["calm"], 0.3), "Children": (["happy"], 0.6), "Other": ([], 0.5),
}


def canonical_genre(raw: str | None) -> str:
    if not raw:
        return "Other"
    for g in GENRES:
        if raw.strip().lower() == g.lower():
            return g
    low = raw.lower()
    for pattern, genre in _GENRE_RULES:
        if re.search(pattern, low):
            return genre
    return "Other"


_WORDS = {
    "uz": set("men sen u biz siz ular meni seni uni bilan uchun emas edi ekan deb hech qil qiling qalb yurak kongil "
              "dil yor jon jonim sevgi sevaman sevgim seni ayt aytib kel keldi ketdi ketma boldi bolsa bolib dunyo "
              "koz kozlar yosh hayot baxt baxtim ona onajon otam dard gam yolgiz yiglama yigla sogindim armon "
              "kimdir nega nima qanday qachon bugun erta kecha tun kun oy yulduz gul gulim bahor yana faqat hamma bari "
              "kelgin kelsang ketsang yuragim kozlaring".split()),
    "ru": set("я ты он она мы вы они меня тебя тебе мне не на что как это все всё так мой моя твой твоя любовь "
              "люблю сердце ночь день где когда если только нет да был была будет есть".split()),
    "en": set("the you and i me my your love to a in it is of that we be all like dont know baby oh yeah "
              "what when never ever want need feel heart night tonight just can cant im youre its this with "
              "for on so up down go way time say one no".split()),
    "tr": set("ben sen bir ve bu ne da de için gibi aşk seni beni sana bana çok yok var olsun gel git kalbim".split()),
}
_UZ_CYR_WORDS = set("мен сен билан учун эмас эди экан қалб юрак ёр жон севги севаман дунё кўз ҳаёт бахт она".split())


_UZ_NAME = re.compile(r"(bek|jon|xon|zoda|ov|ova|yev|yeva|iy|boy|oy|nisa)\b", re.I)


def guess_language(*texts: str, artist: str = "") -> str:
    """Rough language detection (used only when AI tagging is off)."""
    joined = " ".join(t for t in texts if t)
    if not joined.strip():
        return "other"
    low = joined.lower()
    if re.search(r"[가-힯]", joined):
        return "ko"
    if re.search(r"[؀-ۿ]", joined):
        return "ar"
    words = re.findall(r"[\w'ʻʼ‘’`]+", low)
    cyr = sum(1 for w in words if re.search(r"[Ѐ-ӿ]", w))
    if cyr > len(words) * 0.4:
        uz = sum(1 for w in words if w in _UZ_CYR_WORDS) + 3 * len(re.findall(r"[ўқғҳ]", low))
        return "uz" if uz >= 2 else "ru"
    plain = [re.sub(r"['ʻʼ‘’`]", "", w) for w in words]
    scores = {lang: sum(1 for w in plain if w in vocab) for lang, vocab in _WORDS.items() if lang != "ru"}
    scores["uz"] += 2 * len(re.findall(r"\b[og]['ʻʼ‘’`]", low))  # oʻ gʻ
    scores["uz"] += sum(1 for w in plain if re.search(r"(lar|lari|larim|ning|imni|ingni|dagi|gan|moq|yapti|man|san)$", w)) // 2
    scores["tr"] += 2 * len(re.findall(r"[ğış]", low))
    best = max(scores, key=scores.get)
    if scores[best] >= 2:
        return best
    if not scores["en"] and (scores["uz"] or _UZ_NAME.search(artist or "")):
        return "uz"  # few words to go by; an Uzbek word or a Central Asian artist name is the best hint
    return "en" if re.search(r"[a-z]", low) else "other"


_MOOD_WORDS = {
    "sad": "cry tears alone lonely pain hurt goodbye broken miss sorry yigla yiglama yolgiz dard gam sogindim "
           "ketma ketding armon плачу слезы одна один боль прощай",
    "romantic": "love kiss baby heart darling together forever sevgi sevaman yor jonim yurak qalb dil "
                "любовь люблю сердце нежно",
    "party": "dance party tonight club floor move body raqs bazm toy танцуй танцы клуб",
    "motivational": "rise fight believe strong win power dream never give up champion kuch galaba orzu",
    "nostalgic": "remember memories old days yesterday childhood esla xotira bolalik вспомни помню",
    "calm": "slow quiet peace rain sleep calm tinch sokin yomgir тихо",
}


def guess_moods(genre: str, bpm: int | None, lyrics_text: str | None) -> tuple[list[str], float]:
    """Moods + energy from genre, tempo and lyric keywords (used only when AI tagging is off)."""
    moods, energy = GENRE_PROFILE.get(genre, ([], 0.5))
    moods = list(moods)
    if bpm:
        energy += 0.12 if bpm >= 125 else -0.12 if bpm < 85 else 0
    if lyrics_text:
        words = re.findall(r"\w+", re.sub(r"['ʻʼ‘’`]", "", lyrics_text.lower()))
        counts = {m: sum(1 for w in words if w in set(v.split())) for m, v in _MOOD_WORDS.items()}
        ranked = [m for m, c in sorted(counts.items(), key=lambda x: -x[1]) if c >= 3]
        if ranked:
            moods = (ranked + [m for m in moods if m not in ranked])[:3]
            if ranked[0] in ("sad", "calm"):
                energy -= 0.1
            elif ranked[0] in ("party", "motivational"):
                energy += 0.1
    return moods, round(min(1.0, max(0.05, energy)), 2)


GENRE_UZ = {
    "Pop": "Pop", "Estrada": "Estrada", "Hip-Hop": "Hip-hop / Rep", "R&B": "R&B", "Rock": "Rok",
    "Electronic": "Elektron", "Dance": "Raqs", "Folk": "Xalq / An'anaviy", "Classical": "Klassik", "Jazz": "Jaz",
    "Lo-fi": "Lo-fi / Chill", "Indie": "Indi", "Metal": "Metal", "Latin": "Lotin", "K-Pop": "K-Pop",
    "Soundtrack": "Saundtrek", "Religious": "Ma'naviy", "Children": "Bolalar", "Other": "Boshqa",
}
MOOD_UZ = {
    "happy": "quvnoq", "sad": "g'amgin", "romantic": "romantik", "energetic": "energik", "calm": "sokin",
    "party": "bazm", "melancholic": "melanxolik", "motivational": "ruhlantiruvchi", "nostalgic": "nostalgik",
    "dark": "qorong'i", "dreamy": "xayolchan", "angry": "shiddatli",
}
LANG_UZ = {
    "uz": "O'zbekcha", "ru": "Ruscha", "en": "Inglizcha", "tr": "Turkcha", "kk": "Qozoqcha", "ky": "Qirg'izcha",
    "tg": "Tojikcha", "az": "Ozarbayjoncha", "fa": "Forscha", "ar": "Arabcha", "hi": "Hindcha", "ko": "Koreyscha",
    "es": "Ispancha", "fr": "Fransuzcha", "de": "Nemischa", "it": "Italyancha", "other": "Boshqa",
    "instrumental": "Instrumental",
}
