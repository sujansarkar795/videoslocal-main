#!/usr/bin/env bash
# Diagnose why the push 403s: what can this token actually do on the repo?
set -euo pipefail
TOKEN_FILE="/c/Users/Lab/.config/openchamber/secrets/dc1a1af515d5d502d9b5a531e23b1744"
TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
API="https://api.github.com"
REPO="sujansarkar795/videoslocal-main"

echo "--- token type ---"
curl -s -D /tmp/vl-h.txt -o /dev/null -H "Authorization: Bearer $TOKEN" "$API/user"
if grep -qi "^x-oauth-scopes" /tmp/vl-h.txt; then
  grep -i "^x-oauth-scopes" /tmp/vl-h.txt
else
  echo "fine-grained token (no classic scopes header)"
fi

echo
echo "--- repo metadata ---"
curl -s -o /dev/null -w "GET /repos/$REPO: %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$API/$REPO" 2>/dev/null || true
curl -s -o /dev/null -w "GET /repos: %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$API/repos/$REPO"

echo
echo "--- permissions on the repo ---"
curl -s -H "Authorization: Bearer $TOKEN" "$API/repos/$REPO/collaborators/sujansarkar795/permission" | head -c 400; echo

echo
echo "--- contents read ---"
curl -s -o /dev/null -w "GET contents: %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$API/repos/$REPO/contents"

echo
echo "--- contents write (dry: PUT would need a real file, so POST a check-run-less route) ---"
echo "checking user repos listing (fine-grained shows only in-scope repos):"
curl -s -H "Authorization: Bearer $TOKEN" "$API/user/repos?per_page=5&sort=updated" | grep -o '"full_name": *"[^"]*"' | head -5
