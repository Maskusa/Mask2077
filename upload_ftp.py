from __future__ import annotations

import argparse
from ftplib import FTP
from pathlib import Path, PurePosixPath

host = '45.84.204.42'
user = 'u302705723.codex'
password = '5sPDLvvK!n*cOu1!'
remote_root = PurePosixPath('/')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Upload a local directory tree to the FTP host.'
    )
    parser.add_argument(
        '--root',
        default='dist-site',
        help='Local directory to upload (default: dist-site)',
    )
    return parser.parse_args()


def ensure_remote_dirs(ftp: FTP, rel: PurePosixPath) -> None:
    if not rel.parts[:-1]:
        ftp.cwd(str(remote_root))
        return
    current = PurePosixPath('/')
    ftp.cwd(str(current))
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


def main() -> None:
    args = parse_args()
    local_root = Path(args.root).resolve()
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
        rel = PurePosixPath(path.relative_to(local_root))
        ensure_remote_dirs(ftp, rel)
        with path.open('rb') as fp:
            ftp.storbinary(f'STOR {rel.name}', fp)
            print(f'[FTP] Uploaded {rel}')

    ftp.quit()


if __name__ == '__main__':
    main()
