@echo off
title Neon Space Multi-Server
echo [1/3] Installing/Checking dependencies...
call npm install express socket.io
echo [2/3] Opening local game...
start http://localhost:3000
echo [3/3] Launching Tunnel and Server...
start "GAME_SERVER" node server.js
cloudflared tunnel --url http://localhost:3000
pause