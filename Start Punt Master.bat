@echo off
title Punt Master — Server
cd /d "C:\Longshot League\longshot-league"
start "Punt Master Server" cmd /k npm run dev -- --host
timeout /t 4 /nobreak >nul
start "" http://localhost:5173/
exit
