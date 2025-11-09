@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "HOST=45.151.183.153"
set "SOCKS_PORT=1080"
set "HTTP_PORT=8080"

if not "%~1"=="" set "HOST=%~1"
if not "%~2"=="" set "SOCKS_PORT=%~2"
if not "%~3"=="" set "HTTP_PORT=%~3"

echo === Proxy diagnostics for %HOST% (SOCKS:%SOCKS_PORT% / HTTP:%HTTP_PORT%) ===
set /p "PROXY_USER=Username (default masku): "
if "%PROXY_USER%"=="" set "PROXY_USER=masku"
set /p "PROXY_PASS=Password (default superproxy123): "
if "%PROXY_PASS%"=="" set "PROXY_PASS=superproxy123"

echo(
echo --- Test-NetConnection (SOCKS port) ---
powershell -NoLogo -NoProfile -Command "Test-NetConnection -ComputerName %HOST% -Port %SOCKS_PORT% | Format-Table -AutoSize"

echo(
echo --- Test-NetConnection (HTTP port) ---
powershell -NoLogo -NoProfile -Command "Test-NetConnection -ComputerName %HOST% -Port %HTTP_PORT% | Format-Table -AutoSize"

echo(
echo --- curl via SOCKS5 ---
curl --proxy socks5://%HOST%:%SOCKS_PORT% --proxy-user %PROXY_USER%:%PROXY_PASS% --ssl-no-revoke https://ifconfig.me

echo(
echo --- curl via HTTP ---
curl --proxy http://%HOST%:%HTTP_PORT% --proxy-user %PROXY_USER%:%PROXY_PASS% --ssl-no-revoke https://ifconfig.me

echo(
echo --- Invoke-WebRequest (HTTP proxy) ---
powershell -NoLogo -NoProfile -Command "$sec = ConvertTo-SecureString '%PROXY_PASS%' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('%PROXY_USER%', $sec); Invoke-WebRequest -UseBasicParsing -Uri https://ifconfig.me -Proxy http://%HOST%:%HTTP_PORT% -ProxyCredential $cred -MaximumRedirection 3 | Select-Object -ExpandProperty Content"

echo(
echo --- WinHTTP config ---
netsh winhttp show proxy

echo(
echo --- WinINet registry ---
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer

set "LOG=%~dp0proxy-test.log"
if exist "%LOG%" del "%LOG%" >nul
for /f "delims=" %%A in ('date /t') do echo %%A>>"%LOG%"
for /f "delims=" %%A in ('time /t') do echo %%A>>"%LOG%"
echo SOCKS: %HOST%:%SOCKS_PORT%>>"%LOG%"
echo HTTP : %HOST%:%HTTP_PORT%>>"%LOG%"
echo USER : %PROXY_USER%>>"%LOG%"

powershell -NoLogo -NoProfile -Command "Test-NetConnection -ComputerName %HOST% -Port %SOCKS_PORT%" >>"%LOG%"
powershell -NoLogo -NoProfile -Command "Test-NetConnection -ComputerName %HOST% -Port %HTTP_PORT%" >>"%LOG%"
curl --proxy socks5://%HOST%:%SOCKS_PORT% --proxy-user %PROXY_USER%:%PROXY_PASS% --ssl-no-revoke https://ifconfig.me >>"%LOG%" 2>&1
curl --proxy http://%HOST%:%HTTP_PORT% --proxy-user %PROXY_USER%:%PROXY_PASS% --ssl-no-revoke https://ifconfig.me >>"%LOG%" 2>&1

echo(
echo Log saved to %LOG%
explorer "%~dp0" >nul 2>&1

echo(
echo Press any key to exit.
pause >nul
endlocal
