from pathlib import Path
text = Path("components/ServerSettings.tsx").read_text(encoding="utf-8", errors="surrogateescape")
needle = "const buildPreparedProfile = useCallback"
start = text.index(needle)
paren_start = text.index('(', start)
paren_end = text.index('=>', paren_start)
signature = text[start:paren_end]
if "source:" in signature:
    raise SystemExit('already updated')
text = text[:paren_start+1] + "\n\n\n\n\n\n    (uri: string, parsed: ParsedVlessProfile, source: 'manual' | 'server' = 'manual'): PreparedVlessProfile " + text[paren_end:]
Path("components/ServerSettings.tsx").write_text(text, encoding='utf-8', errors='surrogateescape')
