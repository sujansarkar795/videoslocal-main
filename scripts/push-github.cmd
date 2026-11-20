@echo off
rem Creates the GitHub repo (via gh, using %GITHUB_TOKEN%) and pushes this project.
rem The token comes from the environment only; it is never written to disk or .git/config.
setlocal enabledelayedexpansion
cd /d "C:\Users\Public\Documents\videoslocal" || exit /b 1

set "GH_TOKEN=%GITHUB_TOKEN%"

rem -- sanitize repo name --
set "REPO=%GITHUB_REPO_NAME%"
set "REPO=%REPO: =-%"
if "%REPO%"=="" (
  echo ERROR: no repository name provided
  exit /b 1
)

set "VIS=%GITHUB_VISIBILITY%"
set "FLAG=--private"
if /i "%VIS%"=="public" set "FLAG=--public"

echo == GitHub account ==
for /f "delims=" %%i in ('gh api user --jq .login') do set "LOGIN=%%i"
echo authenticated as: %LOGIN%

echo.
echo == git setup ==
if not exist ".git" git init -b main
git config user.name "%GIT_AUTHOR_NAME%"
git config user.email "%GIT_AUTHOR_EMAIL%"

echo.
echo == commit ==
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "videoslocal.store — self-hosted video transfer desk" -m "Express server driving yt-dlp + ffmpeg, static front end (transfer UI, guides, legal pages), consent-gated AdSense slots, Docker + Caddy deploy."
)
git log --oneline -3

echo.
echo == repo create / remote ==
gh repo view "%LOGIN%/%REPO%" >nul 2>&1
if not errorlevel 1 (
  echo repo already exists: %LOGIN%/%REPO%
  git remote remove origin 2>nul
  git remote add origin "https://github.com/%LOGIN%/%REPO%.git"
) else (
  gh repo create "%REPO%" "%FLAG%" --source . --remote origin --description "Local video transfer desk built on yt-dlp — resolve a link, save the file to this machine."
)

echo.
echo == auth + push ==
gh auth setup-git >nul 2>&1
git push -u origin main

echo.
echo == done ==
git log --oneline -1
git remote -v
