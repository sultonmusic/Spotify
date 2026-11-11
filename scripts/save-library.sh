#!/usr/bin/env bash
# Commits the library (songs, covers, lyrics, audio, bot state) and pushes it to the current branch.
# Used by the workflow's "Save library" step and, while the bot keeps running, after every new song.
# Writes changed=true|false to $GITHUB_OUTPUT when that exists. Exit code is 1 only if the push failed.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="${GITHUB_OUTPUT:-/dev/null}"
BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"

git config user.name "music-station[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
# songs.json / ads.json are merged item by item if another run committed meanwhile (.gitattributes)
git config merge.library.name "library JSON merge"
git config merge.library.driver "python3 scripts/merge_json.py %O %A %B"
git add -A --sparse library bot/state.json 2>/dev/null || git add -A --sparse library
if git diff --cached --quiet; then
  echo "changed=false" >> "$OUT"
  exit 0
fi
git commit -q -m "🎵 Library update $(date -u '+%Y-%m-%d %H:%M UTC')"
for i in 1 2 3 4 5; do
  if git push -q origin "HEAD:${BRANCH}"; then
    echo "changed=true" >> "$OUT"
    exit 0
  fi
  sleep $((i * 3))
  git pull -q --rebase origin "${BRANCH}"
done
exit 1
