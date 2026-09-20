@echo off
setlocal

:: Crea la sotto-cartella workspace se non esiste
if not exist "%~dp0workspace" mkdir "%~dp0workspace"

:: Cambia la working directory alla cartella workspace
cd /d "%~dp0workspace"

echo Avvio di Mastra Code TUI nella cartella workspace: %CD%...
pnpm --dir "%~dp0..\.." --filter mastracode cli %*
