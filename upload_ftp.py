from ftplib import FTP
from pathlib import Path, PurePosixPath

host = '45.84.204.42'
user = 'u302705723.codex'
password = '5sPDLvvK!n*cOu1!'
remote_root = PurePosixPath('/')
local_root = Path('dist-site')

if not local_root.is_dir():
    raise SystemExit(f'Local directory not found: {local_root}')

ftp = FTP(host, timeout=30)
ftp.encoding = 'utf-8'
ftp.login(user=user, passwd=password)
ftp.set_pasv(True)
print(ftp.getwelcome())
ftp.cwd(str(remote_root))

for path in sorted(local_root.rglob('*')):
    if path.is_dir():
        continue
    rel = path.relative_to(local_root)
    ftp.cwd('/')
    if rel.parts[:-1]:
        current = PurePosixPath('/')
        for part in rel.parts[:-1]:
            if part == '/':
                continue
            current = current.joinpath(part)
            try:
                ftp.mkd(str(current))
                print(f'[FTP] MKDIR {current}')
            except Exception:
                pass
            ftp.cwd(str(current))
    else:
        ftp.cwd('/')
    with path.open('rb') as fp:
        ftp.storbinary(f'STOR {rel.name}', fp)
        print(f'[FTP] Uploaded {rel}')

ftp.quit()
