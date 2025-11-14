from pathlib import Path
path = Path("android/app/src/main/java/com/subtit/player/plugins/NativeVpnPlugin.java")
text = path.read_text(encoding="utf-8", errors="surrogateescape")
if 'V2rayVpnService.start' not in text:
    raise SystemExit('service start not found')
text = text.replace('V2rayVpnService.start(context, launchConfig);', 'V2rayVpnService.start(context, launchConfig);')
path.write_text(text, encoding='utf-8', errors='surrogateescape')
