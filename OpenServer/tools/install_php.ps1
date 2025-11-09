param(
  [string]$Version = "",
  [string]$Arch = "x64",
  [string]$Flavor = "ts"  # ts (Thread Safe) для builtin-сервера
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path "$PSScriptRoot\..").Path
$dest = Join-Path $root 'tools\php'
$phpBin = Join-Path $dest 'php-bin'
if (Test-Path $phpBin) { Remove-Item -Recurse -Force $phpBin }
if (!(Test-Path $phpBin)) { New-Item -Force -ItemType Directory -Path $phpBin | Out-Null }

function TryDownload([string]$u, [string]$out) {
  try { Invoke-WebRequest -Uri $u -OutFile $out -TimeoutSec 120; return $true } catch { return $false }
}

Write-Host "Получаю список релизов..."
$shaUrl = 'https://windows.php.net/downloads/releases/sha256sum.txt'
$sha = Invoke-WebRequest -Uri $shaUrl -UseBasicParsing
$lines = $sha.Content -split "`n"

$wantNts = ($Flavor -eq 'nts')
$candidatesAll = foreach ($ln in $lines) {
  if ($ln -notmatch '\*php-.*\.zip') { continue }
  $fn = ($ln -split '\*')[-1].Trim()
  if ([string]::IsNullOrWhiteSpace($Version)) {
    if ($fn -notmatch '^php-8\.[23]\.\d+(-nts)?-Win32-(vs17|vs16)-' + [regex]::Escape($Arch) + '\.zip$') { continue }
  } else {
    if ($fn -notmatch '^php-' + [regex]::Escape($Version) + '(-nts)?-Win32-(vs17|vs16)-' + [regex]::Escape($Arch) + '\.zip$') { continue }
  }
  if ($wantNts -and ($fn -notmatch '-nts-')) { continue }
  if (-not $wantNts -and ($fn -match '-nts-')) { continue }
  $fn
}
if (-not $candidatesAll -or $candidatesAll.Count -eq 0) { throw "Не найден подходящий архив PHP в списке релизов." }

# Приоритет: 8.3 > 8.2; vs17 > vs16; более свежая версия (по строке — уже по списку)
$files = $candidatesAll | Sort-Object {
  $score = 0
  if ($_ -match 'php-8\.3\.') { $score += 0 } else { $score += 10 }
  if ($_ -match 'vs17') { $score += 0 } else { $score += 1 }
  $score
}
$fileName = $files[0]
$candidates = @(@{ url = "https://windows.php.net/downloads/releases/$fileName"; name = $fileName })

$zipPath = Join-Path $dest 'php.zip'
$downloaded = $false
foreach ($c in $candidates) {
  Write-Host "Пробую скачать: $($c.url)"
  if (TryDownload $c.url $zipPath) { $downloaded = $true; break }
}
if (-not $downloaded) { throw "Не удалось скачать архив PHP для $Version ($Arch, $Flavor)" }

Write-Host "Скачиваю $($candidates[0].name) ..."
Write-Host "Распаковываю ..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $phpBin)
Remove-Item $zipPath

# Создадим php.ini с минимальными настройками
$ini = @'
[PHP]
max_execution_time=120
memory_limit=256M
date.timezone=UTC
extension_dir="ext"
'@
Set-Content -Path (Join-Path $phpBin 'php.ini') -Value $ini -Encoding ASCII

Write-Host "PHP установлен в: $phpBin"
Write-Host "Запустите: .\\serve.ps1 -Hostname localhost -Port 4173"
