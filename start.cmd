@echo off
title Life Skill Tree
cd /d "%~dp0"

if not exist "index.html" goto nobuild

start "" "index.html"
echo.
echo   Opened : index.html
echo   Manual : see the "docs" folder
echo.
timeout /t 3 >nul
exit /b 0

:nobuild
echo.
echo   [x] index.html not found.
echo       Run rebuild.cmd first (needs Node.js), or send me the error.
echo.
pause
exit /b 1
