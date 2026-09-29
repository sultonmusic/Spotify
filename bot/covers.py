"""Cover art: square crop, resize, and a dominant colour for the player background."""
from __future__ import annotations

import colorsys
import io
from pathlib import Path

from PIL import Image, ImageOps

SIZE = 600


def save_cover(data: bytes, dest: Path) -> str | None:
    """Saves a square JPEG cover. Returns the accent colour as #rrggbb, or None if the image is unusable."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as exc:
        print(f"[cover] {exc}")
        return None
    if min(img.size) < 80:
        return None
    img = ImageOps.fit(img, (SIZE, SIZE), Image.LANCZOS) if min(img.size) >= SIZE else ImageOps.fit(
        img, (min(img.size),) * 2, Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "JPEG", quality=84, optimize=True, progressive=True)
    return accent_color(img)


def accent_color(img: Image.Image) -> str:
    small = img.copy()
    small.thumbnail((64, 64))
    quant = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    palette = quant.getpalette() or []
    counts = sorted(quant.getcolors() or [], reverse=True)
    best, best_score = (40, 40, 40), -1.0
    total = sum(c for c, _ in counts) or 1
    for count, idx in counts:
        r, g, b = palette[idx * 3: idx * 3 + 3]
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        # Prefer colourful, not too dark / not too bright, reasonably common colours.
        score = (count / total) * 0.6 + s * 0.8 - abs(l - 0.45) * 0.7
        if score > best_score:
            best, best_score = (r, g, b), score
    r, g, b = best
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    l = min(max(l, 0.28), 0.5)  # keep it usable as a dark UI background
    r, g, b = (round(x * 255) for x in colorsys.hls_to_rgb(h, l, s))
    return f"#{r:02x}{g:02x}{b:02x}"
