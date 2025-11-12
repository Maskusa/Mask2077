from pathlib import Path
path = Path("components/ServerSettings.tsx")
text = path.read_text(encoding="utf-8", errors="surrogateescape")
old = "        label: parsed.remark || `${parsed.host}:${parsed.port}`,"
if old not in text:
    raise SystemExit('label fragment not found')
new = old + "\r\n\r\n\r\n\r\n\r\n        source,"
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8', errors='surrogateescape')
