@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM === Windows proxy setup for 3proxy ===
REM Usage: setup_proxy.bat [host] [socks_port] [http_port]
REM Run from an elevated Command Prompt (Run as Administrator).

set "HOST=45.151.183.153"
set "SOCKS_PORT=1080"
set "HTTP_PORT=8080"

if not "%~1"=="" set "HOST=%~1"
if not "%~2"=="" set "SOCKS_PORT=%~2"
if not "%~3"=="" set "HTTP_PORT=%~3"

echo === Connection parameters ===
set /p "PROXY_USER=Username (default masku): "
if "%PROXY_USER%"=="" set "PROXY_USER=masku"
set /p "PROXY_PASS=Password (default superproxy123): "
if "%PROXY_PASS%"=="" set "PROXY_PASS=superproxy123"

echo(
echo [1] Enabling WinINet proxy (Internet Options)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "%HOST%:%HTTP_PORT%" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyOverride /t REG_SZ /d "<local>" /f >nul
if %errorlevel% neq 0 (
  echo [!] Failed to write WinINet settings. Please run as Administrator.
)

echo     Refreshing WinINet state
powershell -NoLogo -NoProfile -Command ^
"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WinInet { [DllImport(\"wininet.dll\", SetLastError = true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength); }'; ^
[WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null; ^
[WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null" >nul 2>&1

echo [2] Configuring WinHTTP proxy
netsh winhttp set proxy %HOST%:%HTTP_PORT%

echo [3] Updating user environment variables
set "HTTP_URL=http://%PROXY_USER%:%PROXY_PASS%@%HOST%:%HTTP_PORT%"
set "SOCKS_URL=socks5://%PROXY_USER%:%PROXY_PASS%@%HOST%:%SOCKS_PORT%"
setx http_proxy "%HTTP_URL%" >nul
setx https_proxy "%HTTP_URL%" >nul
setx all_proxy "%SOCKS_URL%" >nul
setx NO_PROXY "localhost,127.0.0.1" >nul

echo [4] Caching credentials
cmdkey /generic:HTTP://%HOST%:%HTTP_PORT% /user:%PROXY_USER% /pass:%PROXY_PASS% >nul
cmdkey /generic:HTTPS://%HOST%:%HTTP_PORT% /user:%PROXY_USER% /pass:%PROXY_PASS% >nul

echo(
echo === Summary ===
echo Host     : %HOST%
echo HTTP URL : %HTTP_URL%
echo SOCKS URL: %SOCKS_URL%
set "TEST_URL=https://ifconfig.me"

echo(
echo To verify the connection (new console):
echo   curl --proxy %SOCKS_URL% %TEST_URL%
echo   curl --proxy %HTTP_URL% %TEST_URL%

echo(
echo Windows toggle should now be ON. If not, open Settings manually once.
echo Press any key to exit.
pause >nul
endlocal
