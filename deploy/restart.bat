@echo off
REM ============================================
REM  Tekno Tracker Cluster - Kill + Restart
REM  Eski process'i oldurur, GUI exe'yi baslatir
REM ============================================

cd /d %~dp0..

echo Eski process durduruluyor...
taskkill /IM tekno-tracker-cluster.exe /F >nul 2>&1
taskkill /IM tekno-tracker-cluster-debug.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo Baslatiliyor...
start "" tekno-tracker-cluster.exe

echo.
echo Tracker Cluster baslatildi (port 8095)
echo http://localhost:8095/
