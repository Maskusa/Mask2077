#!/usr/bin/env python3
"""
Utility script to drop IPv6 (::/0) entries from WireGuard client configs.

The server currently issues IPv4-only routes, so legacy configs with
"AllowedIPs = 0.0.0.0/0, ::/0" must be rewritten to avoid dead IPv6 routes.
Run this script locally on the server (or via ssh_exec.py) to clean every
*.conf inside /etc/wireguard/clients.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
import re


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Remove ::/0 from WireGuard client configs (keeps IPv4 entries).'
    )
    parser.add_argument(
        '--clients-dir',
        default='/etc/wireguard/clients',
        help='Directory with WireGuard client *.conf files (default: /etc/wireguard/clients)',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Only report files that would change without modifying them.',
    )
    return parser.parse_args()


LINE_RE = re.compile(r'^(\s*AllowedIPs\s*=\s*)(.+?)(\r?\n)?$', re.IGNORECASE)


def cleanup_allowed_ips_line(line: str) -> tuple[str, bool]:
    """Return sanitized line and flag whether it changed."""
    match = LINE_RE.match(line)
    if not match:
        return line, False
    prefix, values, newline = match.groups()
    parts = [part.strip() for part in values.split(',')]
    ipv4_parts = [part for part in parts if part and ':' not in part]
    if not ipv4_parts:
        # nothing to keep - leave line as-is
        return line, False
    normalized = f"{prefix}{', '.join(ipv4_parts)}"
    if newline:
        normalized += newline
    changed = normalized != line
    return normalized, changed


def cleanup_file(path: Path, *, dry_run: bool) -> bool:
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines(keepends=True)
    changed = False
    for idx, line in enumerate(lines):
        new_line, line_changed = cleanup_allowed_ips_line(line)
        if line_changed:
            lines[idx] = new_line
            changed = True
    if changed and not dry_run:
        path.write_text(''.join(lines), encoding='utf-8')
    return changed


def main() -> int:
    args = parse_args()
    clients_path = Path(args.clients_dir).expanduser()
    if not clients_path.is_dir():
        print(f'[!] Directory not found: {clients_path}', file=sys.stderr)
        return 1
    changed_files = []
    for conf_path in sorted(clients_path.glob('*.conf')):
        try:
            if cleanup_file(conf_path, dry_run=args.dry_run):
                changed_files.append(conf_path)
        except OSError as exc:
            print(f'[!] Failed to process {conf_path}: {exc}', file=sys.stderr)
    if changed_files:
        header = 'Would update' if args.dry_run else 'Updated'
        print(f'{header} {len(changed_files)} file(s):')
        for path in changed_files:
            print(f'  - {path}')
    else:
        print('Nothing to change; configs already IPv4-only.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
