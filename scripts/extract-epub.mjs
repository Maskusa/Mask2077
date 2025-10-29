#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

function printUsage() {
  console.error('Usage: node scripts/extract-epub.mjs <path-to-epub> [output-directory]');
}

function ensureDirectory(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function isDirectoryPopulated(path) {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function extractWithPowerShell(source, destination) {
  const script = `
    param($src, $dest)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (-not (Test-Path -LiteralPath $dest)) {
      New-Item -ItemType Directory -Path $dest | Out-Null
    }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest)
  `;
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-Command', script, '-src', source, '-dest', destination],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    throw new Error('PowerShell extraction failed');
  }
}

function extractWithUnzip(source, destination) {
  const result = spawnSync('unzip', ['-o', source, '-d', destination], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('unzip command failed');
  }
}

function main() {
  const [, , sourceArg, destinationArg] = process.argv;
  if (!sourceArg) {
    printUsage();
    process.exit(1);
  }

  const sourcePath = resolve(process.cwd(), sourceArg);
  const extensionIndex = sourcePath.lastIndexOf('.');
  const baseName =
    extensionIndex > -1 ? basename(sourcePath.slice(0, extensionIndex)) : basename(sourcePath);
  const outputPath =
    destinationArg && destinationArg.trim().length > 0
      ? resolve(process.cwd(), destinationArg)
      : join(dirname(sourcePath), baseName);

  if (!existsSync(sourcePath)) {
    console.error(`[extract-epub] Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  console.info(`[extract-epub] Исходный файл: ${sourcePath}`);
  console.info(`[extract-epub] Целевая папка: ${outputPath}`);

  if (isDirectoryPopulated(outputPath)) {
    console.log(`[extract-epub] Папка уже заполнена, распаковка не требуется: ${outputPath}`);
    return;
  }

  ensureDirectory(outputPath);

  try {
    if (process.platform === 'win32') {
      extractWithPowerShell(sourcePath, outputPath);
    } else {
      extractWithUnzip(sourcePath, outputPath);
    }
    console.log(`[extract-epub] Книга распакована: ${outputPath}`);
  } catch (error) {
    console.error(`[extract-epub] Extraction failed: ${error.message}`);
    process.exit(1);
  }
}

main();
