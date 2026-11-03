@echo off
title S. HABIB STEEL & LASER CRAFT
cd /d "%~dp0"
start "" "%~dp0frontend\node_modules\electron\dist\electron.exe" "%~dp0electron-main.cjs"
exit

