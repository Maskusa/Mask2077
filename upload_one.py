from ftplib import FTP
from pathlib import Path
host='45.84.204.42'
user='u302705723.codex'
password='5sPDLvvK!n*cOu1!'
remote_root='/tts_test/web'
local_path=Path('OpenServer/web/tcpdump.php').resolve()
ftp=FTP(host, timeout=30)
ftp.encoding='utf-8'
ftp.login(user=user, passwd=password)
ftp.cwd('/')
parts=[p for p in remote_root.strip('/').split('/') if p]
for part in parts:
    try:
        ftp.mkd(part)
    except Exception:
        pass
    ftp.cwd(part)
with local_path.open('rb') as f:
    ftp.storbinary(f'STOR {local_path.name}', f)
print('Uploaded', local_path)
ftp.quit()
