#!/usr/bin/env bash
# Assembles the static site: web/ (the app) + library/ (songs, covers, lyrics, audio).
# Usage: scripts/build-site.sh [output-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
BUILD="${BUILD_ID:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"

rm -rf "$OUT"
mkdir -p "$OUT/library"
cp -r web/. "$OUT/"
if [ -d library ]; then cp -r library/. "$OUT/library/"; fi
[ -f "$OUT/library/songs.json" ] || echo '{"version":1,"count":0,"artists":{},"songs":[]}' > "$OUT/library/songs.json"

# Cache busting: every deploy gets fresh JS/CSS (same ?v on every import keeps one module instance).
sed -i "s/__BUILD__/${BUILD}/g" "$OUT/index.html" "$OUT/sw.js"
sed -i -E "s#(from \"\./[A-Za-z0-9_-]+\.js)\"#\1?v=${BUILD}\"#g" "$OUT"/js/*.js

# Optional branding from repository variables / the bot itself.
python3 - "$OUT" <<'PY'
import json, os, re, sys, urllib.request
out = sys.argv[1]
name = os.environ.get("APP_NAME", "").strip()
bot = os.environ.get("BOT_USERNAME", "").strip()
token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
if token and not bot:
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=15) as r:
            bot = json.load(r)["result"]["username"]
    except Exception as exc:
        print("getMe failed:", type(exc).__name__)
if not re.fullmatch(r"[A-Za-z0-9_]{3,64}", bot or ""):
    bot = ""
def patch(path, old, new):
    p = os.path.join(out, path)
    with open(p, encoding="utf-8") as f:
        text = f.read()
    with open(p, "w", encoding="utf-8") as f:
        f.write(text.replace(old, new))
if name:
    for path in ("index.html", "manifest.webmanifest", "js/config.js"):
        patch(path, "Cavi Music", name.replace("<", "").replace(">", "").replace('"', ""))
if bot:
    patch("js/config.js", 'botUsername: "CaviSpotifybot"', f'botUsername: "{bot}"')
print(f"site: name={name or 'default'} bot=@{bot or 'default'}")
PY

touch "$OUT/.nojekyll"
echo "Built $OUT (build $BUILD): $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
