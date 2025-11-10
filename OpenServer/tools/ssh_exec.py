from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import paramiko  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    paramiko = None  # type: ignore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Execute a single SSH command and stream stdout/stderr back to the caller.'
    )
    parser.add_argument('host', help='SSH host or IP address')
    parser.add_argument('username', help='SSH username')
    parser.add_argument('password', help='SSH password')
    parser.add_argument(
        'command',
        nargs=argparse.REMAINDER,
        help='Command to execute on the remote host (wrap in quotes).',
    )
    parser.add_argument('--port', type=int, default=22, help='SSH port (default: 22)')
    parser.add_argument(
        '--timeout',
        type=int,
        default=30,
        help='Connection/command timeout in seconds (default: 30)',
    )
    parser.add_argument(
        '--use-plink',
        action='store_true',
        help='Force using plink even if paramiko is available.',
    )
    parser.add_argument(
        '--plink-path',
        default=None,
        help='Explicit path to plink executable (optional).',
    )
    return parser.parse_args()


def _command_string(parts: list[str]) -> str:
    command = ' '.join(parts).strip()
    if not command:
        raise SystemExit('Remote command is required. Wrap it in quotes.')
    return command


def run_via_paramiko(
    host: str,
    username: str,
    password: str,
    command: str,
    *,
    port: int,
    timeout: int,
) -> tuple[int, bytes, bytes]:
    if paramiko is None:
        raise RuntimeError('Paramiko is not available and --use-plink was not provided')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())  # noqa: S501 - controlled env
    ssh.connect(
        host,
        port=port,
        username=username,
        password=password,
        timeout=timeout,
        banner_timeout=timeout,
        auth_timeout=timeout,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        stdin.close()
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read()
        err = stderr.read()
    finally:
        ssh.close()
    return exit_status, out, err


def find_plink(custom_path: str | None = None) -> str | None:
    if custom_path:
        candidate = Path(custom_path).expanduser()
        return str(candidate) if candidate.exists() else None
    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir / 'plink.exe',
        script_dir / 'plink',
        script_dir.parent / 'plink.exe',
        script_dir.parent / 'plink',
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    for name in ('plink', 'plink.exe'):
        resolved = shutil.which(name)
        if resolved:
            return resolved
    return None


def run_via_plink(
    host: str,
    username: str,
    password: str,
    command: str,
    *,
    port: int,
    timeout: int,
    plink_path: str | None,
) -> tuple[int, bytes, bytes]:
    path = find_plink(plink_path)
    if not path:
        raise RuntimeError('plink executable not found and Paramiko is unavailable')
    cmd = [
        path,
        '-batch',
        '-P',
        str(port),
        '-pw',
        password,
        f'{username}@{host}',
        command,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:  # pragma: no cover - runtime failure path
        raise RuntimeError(f'plink timed out while running: {command}') from exc
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    args = parse_args()
    command = _command_string(args.command)
    use_plink = args.use_plink or paramiko is None
    runner = run_via_plink if use_plink else run_via_paramiko
    try:
        kwargs = {'port': args.port, 'timeout': args.timeout}
        if use_plink:
            kwargs['plink_path'] = args.plink_path
        exit_code, out, err = runner(
            args.host,
            args.username,
            args.password,
            command,
            **kwargs,
        )
    except RuntimeError as exc:
        sys.stderr.write(str(exc) + os.linesep)
        return 2
    sys.stdout.buffer.write(out or b'')
    sys.stderr.buffer.write(err or b'')
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
