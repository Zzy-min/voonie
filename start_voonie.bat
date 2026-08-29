@echo off
echo ====================================================
echo   Starting Voonie v2 UI
echo ====================================================
cd /d "%~dp0web-v2"
start "Voonie UI v2" cmd /k "npm install && npm run dev"
start "Voonie API" cmd /k "cd /d \"%~dp0..\" && python -m uvicorn voonie.backend.app.main:app --reload --host 127.0.0.1 --port 8000"
timeout /t 3 /nobreak >nul
start http://127.0.0.1:5173/?version=voice-fix-20260828
echo Main UI: http://127.0.0.1:5173/
echo API: http://127.0.0.1:8000/health
echo Legacy v1 archive: http://127.0.0.1:8000/legacy/
pause
