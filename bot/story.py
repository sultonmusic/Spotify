"""9:16 story image per song (cover, title, artist, platform mark).

Telegram's shareToStory needs a public image URL, so every song gets one on the site:
library/stories/<id>.jpg. (Lyric cards with chosen lines are drawn in the browser.)
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from . import config

W, H = 1080, 1920
_FONTS = {
    True: ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
           "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
    False: ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/Library/Fonts/Arial.ttf"],
}


def _font(size: int, bold: bool) -> ImageFont.ImageFont:
    for path in _FONTS[bold]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _hex(color: str | None) -> tuple[int, int, int]:
    c = (color or "#3a3a3a").lstrip("#")
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (58, 58, 58)


def _fit(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> str:
    if draw.textlength(text, font=font) <= width:
        return text
    while text and draw.textlength(text + "…", font=font) > width:
        text = text[:-1]
    return text + "…"


def render(song: dict, dest: Path) -> bool:
    color = _hex(song.get("color"))
    img = Image.new("RGB", (W, H), color)
    # vertical fade to black
    fade = Image.linear_gradient("L").resize((W, H))
    img = Image.composite(Image.new("RGB", (W, H), (7, 7, 7)), img, fade)
    cover = None
    if song.get("cover"):
        path = config.ROOT / song["cover"]
        if path.exists():
            cover = Image.open(path).convert("RGB")
    if cover:
        back = ImageOps.fit(cover, (W, W)).resize((W, H)).filter(ImageFilter.GaussianBlur(60))
        img = Image.blend(img, back, 0.35)
        size, x, y = 760, (W - 760) // 2, 380
        art = ImageOps.fit(cover, (size, size))
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=28, fill=255)
        shadow = Image.new("L", (W, H), 0)
        ImageDraw.Draw(shadow).rounded_rectangle([x, y + 30, x + size, y + size + 30], radius=40, fill=170)
        shadow = shadow.filter(ImageFilter.GaussianBlur(45))
        img.paste((0, 0, 0), (0, 0), shadow)
        img.paste(art, (x, y), mask)
    draw = ImageDraw.Draw(img)
    title_font, artist_font = _font(70, True), _font(46, False)
    ty = 380 + 760 + 80
    title = _fit(draw, song.get("title", ""), title_font, W - 160)
    draw.text((W // 2, ty), title, font=title_font, fill="white", anchor="mt")
    artist = _fit(draw, song.get("artist", ""), artist_font, W - 160)
    draw.text((W // 2, ty + 100), artist, font=artist_font, fill=(215, 215, 215), anchor="mt")
    # platform mark: the logo in a circle + the name
    fy = H - 170
    logo_path = config.ROOT / "web/icons/icon-512.png"
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGB").resize((72, 72), Image.LANCZOS)
        round_mask = Image.new("L", (72, 72), 0)
        ImageDraw.Draw(round_mask).ellipse([0, 0, 71, 71], fill=255)
        img.paste(logo, (W // 2 - 206, fy - 36), round_mask)
    else:
        draw.ellipse([W // 2 - 206, fy - 36, W // 2 - 134, fy + 36], fill=(0, 0, 0))
    draw.text((W // 2 - 115, fy), config.APP_NAME, font=_font(48, True), fill="white", anchor="lm")
    if config.SITE_URL:
        draw.text((W // 2, fy + 80), config.SITE_URL.replace("https://", "").rstrip("/"), font=_font(30, False),
                  fill=(160, 160, 160), anchor="mm")
    dest.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True, progressive=True)
    dest.write_bytes(buf.getvalue())
    return True


def ensure(song: dict) -> str | None:
    """Renders library/stories/<id>.jpg if missing. Returns the site-relative path."""
    rel = f"library/stories/{song['id']}.jpg"
    dest = config.ROOT / rel
    if not dest.exists():
        try:
            render(song, dest)
        except Exception as exc:  # a missing font etc. must never break adding songs
            print(f"[story] {exc}")
            return None
    return rel
