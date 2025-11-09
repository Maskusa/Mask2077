param(
  [string]$Hostname = "127.0.0.1",
  [int]$Port = 8080,
  [string]$DocRoot = "web"
)

# Keep output in ASCII to avoid encoding issues
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Write-Host ("Starting local server at http://{0}:{1} (root: {2})" -f $Hostname, $Port, $DocRoot)

# 1) PHP builtin server (пытаемся взять из tools\php сначала)
$phpLocal = Join-Path -Path (Join-Path $PSScriptRoot 'tools\php\php-bin') -ChildPath 'php.exe'
$php = $null
if (Test-Path $phpLocal) { $php = Get-Item $phpLocal }
if (-not $php) { $php = Get-Command php -ErrorAction SilentlyContinue }
if ($php) {
  $phpPath = $null
  if ($php -is [System.IO.FileInfo]) { $phpPath = $php.FullName } else { $phpPath = $php.Source }
  # Проверим, что php запускается (частая проблема — нет VC++ runtime)
  $phpOk = $true
  try { & $phpPath -v | Out-Null } catch { $phpOk = $false }
  if (-not $phpOk) {
    Write-Warning ("PHP найден, но не запускается: {0}" -f $phpPath)
    Write-Warning "Возможно, не установлен 'Microsoft Visual C++ Redistributable 2015-2022 (x64)'."
  } else {
    Write-Host ("PHP found: {0}. Starting PHP built-in server..." -f $phpPath)
    Push-Location $DocRoot
    try {
      & $phpPath -S ("{0}:{1}" -f $Hostname, $Port) | Write-Output
    } finally {
      Pop-Location
    }
    exit $LASTEXITCODE
  }
}

# 2) Python http.server
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $py) {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { $pyLauncher = $true }
}
if ($py) {
  Write-Warning "PHP not found - using Python http.server (PHP pages won't run; static only)."
  Write-Host ("Available at: http://{0}:{1} (dir: {2})" -f $Hostname, $Port, $DocRoot)
  if ($pyLauncher) {
    & $py.Source -3 -m http.server $Port --bind $Hostname --directory $DocRoot | Write-Output
  } else {
    & $py.Source -m http.server $Port --bind $Hostname --directory $DocRoot | Write-Output
  }
  exit $LASTEXITCODE
}

# 3) .NET HttpListener (minimal static)
Write-Warning "No PHP and Python. Starting minimal .NET static server."
$prefix = ("http://{0}:{1}/" -f $Hostname, $Port)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host ("Listening {0} (Ctrl+C to stop)" -f $prefix)
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
    $fsPath = Join-Path -Path $DocRoot -ChildPath $path
    if (Test-Path $fsPath) {
      try {
        $bytes = [System.IO.File]::ReadAllBytes($fsPath)
        $ctype = 'application/octet-stream'
        if ($fsPath -match '\.html?$') { $ctype = 'text/html; charset=utf-8' }
        elseif ($fsPath -match '\.js$') { $ctype = 'text/javascript; charset=utf-8' }
        elseif ($fsPath -match '\.css$') { $ctype = 'text/css; charset=utf-8' }
        elseif ($fsPath -match '\.png$') { $ctype = 'image/png' }
        elseif ($fsPath -match '\.jpe?g$') { $ctype = 'image/jpeg' }
        elseif ($fsPath -match '\.svg$') { $ctype = 'image/svg+xml' }
        $res.ContentType = $ctype
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch {
        $res.StatusCode = 500
      } finally {
        $res.OutputStream.Close()
      }
    } else {
      $res.StatusCode = 404
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
