@echo off
title Longshot League — Server
cd /d "C:\Longshot League\longshot-league"
start "Longshot League Server" cmd /k npm run dev
timeout /t 4 /nobreak >nul
start "" http://localhost:5173/
exit
