import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const targetFiles = [
  path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'capacitor.plugins.json'),
  path.join(
    projectRoot,
    'android',
    'app',
    'build',
    'intermediates',
    'assets',
    'debug',
    'mergeDebugAssets',
    'capacitor.plugins.json',
  ),
  path.join(
    projectRoot,
    'android',
    'app',
    'build',
    'intermediates',
    'assets',
    'release',
    'mergeReleaseAssets',
    'capacitor.plugins.json',
  ),
];

const customPlugins = [
  { pkg: '@app/native-utilities', classpath: 'com.subtit.player.plugins.NativeUtilitiesPlugin' },
  { pkg: '@app/native-tts', classpath: 'com.subtit.player.plugins.NativeTTSPlugin' },
  { pkg: '@app/native-purchases', classpath: 'com.subtit.player.plugins.NativePurchasesPlugin' },
  { pkg: '@app/native-web-overlay', classpath: 'com.subtit.player.plugins.NativeWebOverlayPlugin' },
  { pkg: '@app/native-vpn', classpath: 'com.subtit.player.plugins.NativeVpnPlugin' },
];

async function patchFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { filePath, skipped: true };
    }
    throw error;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Не удалось разобрать JSON ${filePath}: ${error.message}`);
  }

  let added = [];
  for (const plugin of customPlugins) {
    const exists = json.some((entry) => entry.classpath === plugin.classpath);
    if (!exists) {
      json.push(plugin);
      added.push(plugin.classpath);
    }
  }

  if (added.length > 0) {
    const formatted = JSON.stringify(json, null, '\t') + '\n';
    await fs.writeFile(filePath, formatted, 'utf8');
  }

  return { filePath, added, skipped: false };
}

async function main() {
  const results = await Promise.all(targetFiles.map(patchFile));
  for (const result of results) {
    const relative = path.relative(projectRoot, result.filePath);
    if (result.skipped) {
      console.warn(`Пропущен ${relative} (нет файла)`);
      continue;
    }
    if (result.added.length === 0) {
      console.log(`Без изменений: ${relative}`);
    } else {
      console.log(`Обновлён ${relative} (+${result.added.length})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
