@echo off
title White Van Ops - Local Launcher
echo ========================================================
echo Starting local PostgreSQL database on port 5433...
echo ========================================================
"C:\Program Files\PostgreSQL\17\bin\pg_ctl" -D "%~dp0pg_data" -o "-p 5433" start

echo.
echo ========================================================
echo Starting Next.js Field Operations Dev Server...
echo ========================================================
set NODE_TLS_REJECT_UNAUTHORIZED=0
npm run dev
