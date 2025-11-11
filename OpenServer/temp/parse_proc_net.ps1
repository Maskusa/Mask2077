param(
  [Parameter(Mandatory=$true)][int]$Uid,
  [Parameter(Mandatory=$true)][string]$InFile
)

# Читаем файл
$lines = Get-Content -Raw -Path $InFile -ErrorAction Stop -Encoding UTF8
$lines = $lines -split "`n" | Where-Object { $_ -ne "" }

if ($lines.Count -lt 2) {
  Write-Host "Файл пустой или нет данных: $InFile"
  exit 1
}

# Определяем индекс колонки uid из заголовка (первая строка)
$header = $lines[0].Trim() -split '\s+'
$uidIndex = [Array]::IndexOf($header, 'uid')
if ($uidIndex -lt 0) {
  # если нет 'uid' в заголовке — попробуем найти похожую колонку (зависит от ядра)
  $uidIndex = ($header | ForEach-Object {$_.ToLower()}) -match 'uid' | ForEach-Object { [Array]::IndexOf($header,$_ ) } | Select-Object -First 1
}
if ($uidIndex -lt 0) {
  Write-Host "Не удалось определить колонку uid в заголовке. Заголовок: $($header -join ' | ')"
  exit 1
}

# Функция: конверт hex IP:PORT -> human
function Decode-AddrPort($hex) {
  # IPv4: aabbccdd:pppp
  if ($hex -match ':') {
    $parts = $hex -split ':'
    $iphex = $parts[0]
    $porthex = $parts[1]
    # IP: split into bytes, reverse (little-endian in /proc/net/*), convert
    $bytes = ($iphex -replace '(..)', '$1 ').Trim() -split ' '
    [array]::Reverse($bytes)
    $ip = ($bytes | ForEach-Object { [Convert]::ToInt32($_,16) }) -join '.'
    $port = [Convert]::ToInt32($porthex,16)
    return "$ip`:$port"
  } else {
    return $hex
  }
}

# Обрабатываем строки данных
$data = $lines | Select-Object -Skip 1
$result = @()
foreach ($line in $data) {
  $f = $line.Trim() -split '\s+'
  if ($f.Length -le $uidIndex) { continue }
  $lineUid = [int]$f[$uidIndex]
  if ($lineUid -eq $Uid) {
    $local = Decode-AddrPort $f[1]
    $remote = Decode-AddrPort $f[2]
    $state = if ($f.Length -gt 3) { $f[3] } else { "" }
    $result += [PSCustomObject]@{
      Local = $local
      Remote = $remote
      State = $state
      Raw = $line.Trim()
    }
  }
}

if ($result.Count -eq 0) {
  Write-Host "Нет записей для UID $Uid в $InFile"
} else {
  $result | Format-Table -AutoSize
}
