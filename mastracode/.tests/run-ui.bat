@echo off
setlocal

echo ===================================================
echo   Avvio di MastraCode Factory UI (Browser SPA)
echo ===================================================
echo.

:: Imposta directory ambiente opzionale per il web host
set "MASTRACODE_ENV_DIR=%~dp0..\web"

:: Posizionati nella directory root del repository
cd /d "%~dp0..\.."

echo Avvio del server di sviluppo Vite su http://localhost:5173 ...
pnpm --filter @internal/factory-ui dev %*
