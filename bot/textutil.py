"""Text cleaning, transliteration and fuzzy matching for song titles."""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh",
    "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya", "ў": "o", "қ": "q", "ғ": "g",
    "ҳ": "h", "ә": "a", "ө": "o", "ү": "u", "ң": "ng", "і": "i", "ї": "i", "є": "e", "ґ": "g",
}

APOSTROPHES = "'`´ʻʼ‘’"

JUNK_PATTERNS = [
    # (Official Video), [Lyrics], (Audio 2024), (Премьера клипа) ...
    r"[\(\[\{][^\)\]\}]*\b(?:official|rasmiy|music\s*video|video\s*clip|videoclip|clip|klip|audio|lyrics?|lyric\s*video|"
    r"visuali[sz]er|mood\s*video|премьера|премьера\s*клипа|клип|премьера\s*песни|premyera|premiere|new|yangi|янги|"
    r"hit|хит|tiktok|тикток|official\s*audio|full\s*version|hd|hq|4k|320\s*kbps|128\s*kbps|mp3)\b[^\)\]\}]*[\)\]\}]",
    r"\b(?:official\s+(?:music\s+)?(?:video|audio)|music\s+video|lyrics?\s+video|video\s*clip|audio\s+version)\b",
    r"\b(?:premyera|premiere|премьера(?:\s+(?:клипа|песни|трека))?)\b(?:\s*\d{4})?",
    r"\b(?:hd|hq|4k|1080p|720p|480p|320\s*kbps|256\s*kbps|192\s*kbps|128\s*kbps)\b",
    r"https?://\S+", r"\bt\.me/\S+", r"\bwww\.\S+",
    r"\b[\w\-]+\.(?:uz|ru|com|net|org|me|io|tv|fm|kz|tj|kg|su|info|biz|pro|cc|club|top)\b",
    r"@[\w_]+", r"#[\w_]+",
    r"\((?:\s*(?:19|20)\d{2}\s*)\)",
]
EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F900-\U0001F9FF\U00002B00-\U00002BFF️‍]+"
)
FEAT_RE = re.compile(r"\s*[\(\[]?\s*\b(?:feat\.?|ft\.?|featuring|при\s+уч\.?)\s+([^\)\]]+?)[\)\]]?\s*$", re.I)
SEPARATORS = re.compile(r"\s+[-–—−]+\s+|\s*[-–—]{2,}\s*|_-_|\s+\|\s+|\s+•\s+|\s+~\s+")


def translit(text: str) -> str:
    out = []
    for ch in text:
        low = ch.lower()
        if low in CYR_TO_LAT:
            lat = CYR_TO_LAT[low]
            out.append(lat.capitalize() if ch != low and lat else lat)
        else:
            out.append(ch)
    return "".join(out)


def norm(text: str) -> str:
    """Aggressive normalisation for comparing strings across scripts and spellings."""
    text = translit(text or "").lower()
    for a in APOSTROPHES:
        text = text.replace(a, "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("&", " and ")
    text = re.sub(r"[^\w\s]", " ", text)
    text = text.replace("_", " ")
    # Common Uzbek/Russian spelling variants
    text = re.sub(r"kh", "x", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean(text: str) -> str:
    """Strip channel names, links, 'official video' junk etc. from a title."""
    if not text:
        return ""
    text = EMOJI_RE.sub(" ", text)
    text = text.replace("_", " ")
    for pattern in JUNK_PATTERNS:
        text = re.sub(pattern, " ", text, flags=re.I)
    text = re.sub(r"^\s*\d{1,3}\s*[\.\)\-]\s+", "", text)  # "01. " track numbers
    text = re.sub(r"[\(\[\{]\s*[\)\]\}]", " ", text)  # now-empty brackets
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -–—|•~.,:;\"'")


def split_artist_title(text: str) -> tuple[str, str]:
    """'Artist - Title' -> (artist, title). Unknown artist -> ('', text)."""
    text = clean(text)
    parts = [p.strip() for p in SEPARATORS.split(text) if p.strip()]
    if len(parts) >= 2:
        return parts[0], " - ".join(parts[1:])
    if " - " not in text and "-" in text and text.count("-") == 1:
        a, b = (p.strip() for p in text.split("-"))
        if a and b and not re.search(r"\d", a):
            return a, b
    return "", text


def split_artists(artist: str) -> list[str]:
    parts = re.split(r"\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bи\b|\bva\b|/|;)\s*", artist or "", flags=re.I)
    seen, out = set(), []
    for p in parts:
        p = p.strip(" .-")
        if p and norm(p) not in seen:
            seen.add(norm(p))
            out.append(p)
    return out


def strip_feat(title: str) -> tuple[str, list[str]]:
    m = FEAT_RE.search(title or "")
    if not m:
        return title, []
    return title[: m.start()].strip(), split_artists(m.group(1))


def similarity(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    token = len(ta & tb) / max(1, min(len(ta), len(tb)))
    contained = 0.9 if (a in b or b in a) and min(len(a), len(b)) >= 4 else 0.0
    return max(ratio, token * 0.95, contained)

