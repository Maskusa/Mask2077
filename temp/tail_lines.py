from pathlib import Path
lines = Path("components/ServerSettings.tsx").read_text(encoding="utf-8", errors="surrogateescape").splitlines(keepends=True)
for i in range(len(lines)-40, len(lines)):
    print(i, repr(lines[i]))
