@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js and try again.
  pause
  exit /b 1
)
echo Starting the local copy editor...
echo Keep this window open. Press Ctrl+C to stop.
node server.mjs --open-editor
pause
