from pathlib import Path
path = Path("components/ServerSettings.tsx")
text = path.read_text(encoding="utf-8", errors="surrogateescape")
old_sig = "  const buildPreparedProfile = useCallback(\r\n\r\n\r\n\r\n\r\n    (uri: string, parsed: ParsedVlessProfile): PreparedVlessProfile => {"
new_sig = "  const buildPreparedProfile = useCallback(\r\n\r\n\r\n\r\n\r\n    (uri: string, parsed: ParsedVlessProfile, source: 'manual' | 'server' = 'manual'): PreparedVlessProfile => {"
if old_sig not in text:
    raise SystemExit('signature not found')
text = text.replace(old_sig, new_sig, 1)
old_return = "        outboundTag: 'proxy-out',\r\n\r\n\r\n\r\n\r\n        label: parsed.remark || `${parsed.host}:${parsed.port}`,\r\n\r\n\r\n\r\n\r\n      };"
new_return = "        outboundTag: 'proxy-out',\r\n\r\n\r\n\r\n\r\n        label: parsed.remark || `${parsed.host}:${parsed.port}`,\r\n\r\n\r\n\r\n\r\n        source,\r\n\r\n\r\n\r\n\r\n      };"
if old_return not in text:
    raise SystemExit('return block not found')
text = text.replace(old_return, new_return, 1)
path.write_text(text, encoding='utf-8', errors='surrogateescape')
