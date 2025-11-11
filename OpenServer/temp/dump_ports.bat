@echo off
setlocal

rem --- Параметры ---
set "OUTDIR=H:\Project\Mask2077\OpenServer\temp"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

rem Получаем метку времени через PowerShell (без запрещённых символов)
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"`) do set "TS=%%T"
set "OUTFILE_BASE=%OUTDIR%\ports_%TS%"

rem --- Попытка для рутованного устройства (su) ---
echo Попытка выполнить с root (su)...
adb wait-for-device
adb exec-out su -c "ss -lupn 2>&1; echo; ss -ltpn 2>&1" > "%OUTFILE_BASE%_root.txt" 2> "%OUTFILE_BASE%_root_err.txt"

rem Проверим, есть ли полезный вывод
findstr /R /C:"LISTEN" /C:"udp" "%OUTFILE_BASE%_root.txt" >nul 2>&1
if %ERRORLEVEL%==0 (
  echo Получены данные с root. Сохранено в "%OUTFILE_BASE%_root.txt"
  echo Порты сохранены в "%OUTFILE_BASE%_root.txt"
  goto :END
) else (
  echo Root недоступен или ss вернул пустой вывод. Переходим к fallback (без root)...
)

rem --- FALLBACK: команды, которые работают без root (ограниченно) ---
echo Снимаем все UDP/TCP сокеты (без PID/имён)...
adb shell ss -u -a -n 2> "%OUTFILE_BASE%_ss_udp_err.txt" > "%OUTFILE_BASE%_udp.txt"
adb shell ss -t -a -n 2> "%OUTFILE_BASE%_ss_tcp_err.txt" > "%OUTFILE_BASE%_tcp.txt"

rem Получим список сетевых интерфейсов (чтобы увидеть tun0 и пр.)
adb shell ip addr show > "%OUTFILE_BASE%_if.txt" 2> "%OUTFILE_BASE%_if_err.txt"

rem Попробуем получить UID пакета WireGuard (официальный пакет: com.wireguard.android)
echo Получаем информацию о пакете WireGuard (UID)...
adb shell dumpsys package com.wireguard.android > "%OUTFILE_BASE%_wg_dumpsys.txt" 2> "%OUTFILE_BASE%_wg_dumpsys_err.txt"
adb shell cmd package list packages -U | findstr /I "wireguard" > "%OUTFILE_BASE%_pkg_list_uid.txt" 2> "%OUTFILE_BASE%_pkg_list_uid_err.txt"

rem Выведем строку с UID (если есть) в отдельный файл для быстрой проверки
type "%OUTFILE_BASE%_pkg_list_uid.txt" > "%OUTFILE_BASE%_wg_uid_quick.txt" 2>nul

rem Также снимем /proc/net/udp and /proc/net/tcp (сырой формат) — может помочь сопоставлению
adb shell cat /proc/net/udp > "%OUTFILE_BASE%_proc_net_udp.txt" 2> "%OUTFILE_BASE%_proc_net_udp_err.txt"
adb shell cat /proc/net/tcp > "%OUTFILE_BASE%_proc_net_tcp.txt" 2> "%OUTFILE_BASE%_proc_net_tcp_err.txt"

echo Fallback выполнен. Сохранены файлы:
echo   %OUTFILE_BASE%_udp.txt
echo   %OUTFILE_BASE%_tcp.txt
echo   %OUTFILE_BASE%_if.txt
echo   %OUTFILE_BASE%_wg_dumpsys.txt
echo   %OUTFILE_BASE%_pkg_list_uid.txt
echo   %OUTFILE_BASE%_proc_net_udp.txt

:END
endlocal
pause
