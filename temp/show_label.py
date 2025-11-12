from pathlib import Path
text = Path("components/ServerSettings.tsx").read_text(encoding="utf-8", errors="surrogateescape")
needle = "label: parsed.remark"
idx = text.index(needle)
print(text[idx-200:idx+200])
