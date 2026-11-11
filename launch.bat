@echo off
title "S. HABIB STEEL & LASER CRAFT"
cd /d "%~dp0"

set "DEV_ELECTRON=%~dp0frontend\node_modules\electron\dist\electron.exe"
set "PACKAGED_APP=%~dp0dist-electron\win-unpacked\S. HABIB STEEL & LASER CRAFT.exe"

if exist "%DEV_ELECTRON%" (
	start "" "%DEV_ELECTRON%" "%~dp0electron-main.cjs"
	exit /b 0
)

if exist "%PACKAGED_APP%" (
	start "" "%PACKAGED_APP%"
	exit /b 0
)

echo Could not find the Electron runtime or packaged app.
echo Install the frontend dependencies or install the Windows app first.
pause

