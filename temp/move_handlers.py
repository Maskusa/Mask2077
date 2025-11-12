from pathlib import Path
path = Path("components/ServerSettings.tsx")
lines = path.read_text(encoding="utf-8", errors="surrogateescape").splitlines(keepends=True)
start_idx = next(i for i,l in enumerate(lines) if "const handleStartVpn" in l)
stop_idx = next(i for i,l in enumerate(lines) if "const handleStopVpn" in l)
stop_end = None
for i in range(stop_idx, len(lines)):
    if "}, [appendLog]);" in lines[i]:
        stop_end = i + 1
        break
if stop_end is None:
    raise SystemExit('handleStop end not found')
block = lines[start_idx:stop_end]
# remove block
remaining = lines[:start_idx] + lines[stop_end:]
return_idx = next(i for i,l in enumerate(remaining) if "return (" in l)
new_lines = remaining[:return_idx] + block + ["\n"] + remaining[return_idx:]
path.write_text(''.join(new_lines), encoding='utf-8', errors='surrogateescape')
