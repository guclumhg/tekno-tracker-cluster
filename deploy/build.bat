@echo off
REM ============================================
REM  Tekno Tracker Cluster - Derleme
REM  GUI exe (konsol penceresi acilmaz) + debug exe
REM ============================================

cd /d %~dp0..

echo [1/2] Debug exe derleniyor...
go build -o tekno-tracker-cluster-debug.exe .
if %ERRORLEVEL% NEQ 0 (
    echo HATA: Debug build basarisiz!
    exit /b 1
)

echo [2/2] GUI exe derleniyor (windowsgui)...
go build -ldflags "-H=windowsgui" -o tekno-tracker-cluster.exe .
if %ERRORLEVEL% NEQ 0 (
    echo HATA: GUI build basarisiz!
    exit /b 1
)

echo.
echo Derleme tamamlandi!
echo   tekno-tracker-cluster-debug.exe  (konsol ciktili)
echo   tekno-tracker-cluster.exe        (arka plan, GUI)
