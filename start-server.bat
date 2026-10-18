@echo off
setlocal
chcp 65001 >nul
title File Server
cd /d "%~dp0"
echo Starting File Server...
echo.
npm start
echo.
echo File Server has stopped.
pause
