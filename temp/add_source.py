from pathlib import Path
text = Path("components/ServerSettings.tsx").read_text(encoding="utf-8", errors="surrogateescape")
needle = "interface PreparedVlessProfile"
start = text.index(needle)
brace_start = text.index('{', start)
brace_end = text.index('}', brace_start)
block = text[brace_start+1:brace_end]
if "source:" in block:
    raise SystemExit('already added')
block = block.rstrip() + "\r\n\r\n\r\n  source: 'manual' | 'server';\r\n\r\n\r\n"
text = text[:brace_start+1] + block + text[brace_end:]
Path("components/ServerSettings.tsx").write_text(text, encoding='utf-8', errors='surrogateescape')
