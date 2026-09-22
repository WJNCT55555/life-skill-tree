@echo off
title Rebuild Life Skill Tree
cd /d "%~dp0"

echo.
echo   Rebuild the app
echo   (run this after editing v3\data.mjs or v3\template.html)
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

node v3\build.mjs
if errorlevel 1 goto buildfail

echo   Done. Open "index.html" (double-click) to see it.
echo.
pause
exit /b 0

:nonode
echo   [x] Node.js not found. Install it first: https://nodejs.org
echo.
pause
exit /b 1

:buildfail
echo.
echo   Self-check failed: the data you edited has a problem.
echo   Fix it as the message above says. The build script refuses
echo   to generate a broken app on purpose.
echo.
pause
exit /b 1
