@echo off
setlocal
cd /d "%~dp0"
title Photobooth - local test server (close this window to stop)
set PORT=8080

rem ---- server: Node.js (fast, multi-request) if installed, otherwise PHP fallback ----
set USENODE=0
node -v >nul 2>nul
if not errorlevel 1 set USENODE=1

if "%USENODE%"=="0" (
  set PHPEXE=php
  if exist "%~dp0php\php.exe" set PHPEXE="%~dp0php\php.exe"
  if exist "D:\php\php.exe" set PHPEXE="D:\php\php.exe"
  %PHPEXE% -v >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  Neither Node.js nor PHP was found.
    echo  Install Node.js LTS from https://nodejs.org  ^(recommended^) and run this file again.
    echo.
    pause
    exit /b 1
  )
)

rem ---- find this PC's Wi-Fi/LAN address (the phone needs it to open the QR link) ----
> "%temp%\booth_ip.ps1" echo try{$s=New-Object Net.Sockets.UdpClient;$s.Connect('8.8.8.8',80);$s.Client.LocalEndPoint.Address.ToString()}catch{}
set IP=
for /f %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%temp%\booth_ip.ps1"') do set IP=%%i
if "%IP%"=="" set IP=localhost

if not exist photos mkdir photos

echo.
echo  ============================================================
echo   Kiosk (this PC)  : http://localhost:%PORT%/
echo   QR links point to: http://%IP%:%PORT%/photos/...
echo   Phone must be on the SAME Wi-Fi as this PC.
echo   If the phone cannot open the link: allow "node" / "php" through
echo   Windows Firewall ^(Private networks^) when Windows asks.
echo   Saved photos     : %~dp0photos
if "%USENODE%"=="1" (echo   Server           : Node.js) else (echo   Server           : PHP ^(slow - install Node.js^))
echo  ============================================================
echo.

rem localhost keeps the camera allowed; ?pub= tells the page which address to put in the QR
start "" "http://localhost:%PORT%/?pub=http://%IP%:%PORT%"
if "%USENODE%"=="1" (
  node server.js
) else (
  %PHPEXE% -S 0.0.0.0:%PORT% -t "%~dp0"
)
pause
