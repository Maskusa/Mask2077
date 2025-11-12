from pathlib import Path
text = Path("components/ServerSettings.tsx").read_text(encoding="utf-8", errors="surrogateescape")
with Path("components/ServerSettings.tsx").open('w', encoding='utf-8', newline='\r\n') as f:
    f.write(text)
