#!/usr/bin/env bash
# Push-only variant: the repo already exists on github.com; no repo creation here.
# Token is read from the OpenChamber secret file, never printed or stored.
set -euo pipefail

TOKEN_FILE="/c/Users/Lab/.config/openchamber/secrets/6c003d5d73713c7a964716e019775ffc"
REPO="videoslocal-main"
ROOT="/c/Users/Public/Documents/videoslocal"

[ -f "$TOKEN_FILE" ] || { echo "ERROR: token file missing (expired? ask me to re-request)"; exit 1; }
TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
[ -n "$TOKEN" ] || { echo "ERROR: token file empty"; exit 1; }

HDR=$(mktemp); RESP=$(mktemp)
trap 'rm -f "$HDR" "$RESP" /tmp/vl-askpass.sh' EXIT
printf 'Authorization: Bearer %s\n' "$TOKEN" > "$HDR"

echo "== GitHub account =="
STATUS=$(curl -s -o "$RESP" -w '%{http_code}' -H @"$HDR" https://api.github.com/user)
[ "$STATUS" = "200" ] || { echo "token check failed (HTTP $STATUS)"; exit 1; }
LOGIN=$(grep -o '"login": *"[^"]*"' "$RESP" | head -1 | sed 's/.*"login": *"//;s/"//')
UID_=$(grep -o '"id": *[0-9]*' "$RESP" | head -1 | sed 's/.*: //')
echo "authenticated as: $LOGIN (id $UID_)"

echo
echo "== wait for repo $LOGIN/$REPO =="
FOUND=""
for i in $(seq 1 24); do
  STATUS=$(curl -s -o "$RESP" -w '%{http_code}' -H @"$HDR" "https://api.github.com/repos/$LOGIN/$REPO")
  if [ "$STATUS" = "200" ]; then FOUND=yes; break; fi
  sleep 10
done
if [ -z "$FOUND" ]; then
  echo "repo https://github.com/$LOGIN/$REPO does not exist yet."
  echo "Create it: github.com → New repository → name \"videoslocal-main\" → Private → no README, no gitignore → Create."
  exit 2
fi
echo "repo found"

cd "$ROOT"
echo
echo "== git setup =="
[ -d .git ] || git init -b main
git branch -M main 2>/dev/null || true
git config user.name  "$LOGIN"
git config user.email "${UID_}+${LOGIN}@users.noreply.github.com"

echo
echo "== commit =="
git add -A
if git diff --cached --quiet; then
  echo "nothing new to commit"
else
  git commit -m "videoslocal.store — self-hosted video transfer desk" -m "Express server driving yt-dlp + ffmpeg; static front end (transfer UI, guides, legal pages); consent-gated AdSense slots; Docker + Caddy deploy."
fi
git log --oneline -3 || true

git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$LOGIN/$REPO.git"

echo
echo "== push (token via askpass, never stored) =="
cat > /tmp/vl-askpass.sh <<'EOS'
#!/bin/sh
case "$1" in
  Username*) echo "x-access-token" ;;
  *) cat "/c/Users/Lab/.config/openchamber/secrets/6c003d5d73713c7a964716e019775ffc" ;;
esac
EOS
chmod +x /tmp/vl-askpass.sh
# -c credential.helper= clears the Windows credential manager for this push only,
# so the token from the askpass script is what authenticates.
if GIT_ASKPASS=/tmp/vl-askpass.sh GIT_TERMINAL_PROMPT=0 git -c credential.helper= push -u origin main; then
  rm -f "$TOKEN_FILE"
  echo "token file deleted"
else
  echo "PUSH FAILED — token kept for a retry"
  exit 1
fi

echo
echo "== done =="
git log --oneline -1
git remote -v
echo "repo: https://github.com/$LOGIN/$REPO"
