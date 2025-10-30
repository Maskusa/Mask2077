[CmdletBinding()]
param(
  [string]$Hostname = "localhost",
  [int]   $Port     = 4173,
  [string]$Root     = $(if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { Join-Path $PSScriptRoot "dist-site" } else { "" }),
  [switch]$SpaFallback,
  [switch]$VerboseLog
)

# --- Console encoding (UTF-8), but messages are ASCII/English only ---
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
  try { [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }
} catch { }

# --- Resolve script root fallback ---
$ScriptRootResolved = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  $PSScriptRoot
} else {
  (Get-Location).Path
}

# --- Auto Root if not provided ---
if (-not $PSBoundParameters.ContainsKey('Root') -or [string]::IsNullOrWhiteSpace($Root)) {
  $candidate = Join-Path $ScriptRootResolved "dist-site"
  if (Test-Path -LiteralPath $candidate -PathType Container) { $Root = $candidate } else { $Root = $ScriptRootResolved }
}

# --- Validate Root ---
try {
  $Root = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
} catch {
  Write-Error ("Root folder not found: {0}" -f $Root)
  exit 2
}

# --- MIME map ---
$Mime = @{
  ".html"="text/html; charset=utf-8"; ".htm"="text/html; charset=utf-8"
  ".css"="text/css; charset=utf-8"
  ".js"="application/javascript; charset=utf-8"; ".mjs"="application/javascript; charset=utf-8"
  ".json"="application/json; charset=utf-8"; ".map"="application/json; charset=utf-8"
  ".txt"="text/plain; charset=utf-8"; ".xml"="application/xml"
  ".svg"="image/svg+xml"; ".ico"="image/x-icon"
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"
  ".webp"="image/webp"; ".avif"="image/avif"; ".wasm"="application/wasm"
  ".pdf"="application/pdf"; ".woff"="font/woff"; ".woff2"="font/woff2"; ".ttf"="font/ttf"; ".eot"="application/vnd.ms-fontobject"
}
function Get-ContentType([string]$Path){
  $ext=[IO.Path]::GetExtension($Path).ToLowerInvariant()
  if($Mime.ContainsKey($ext)){ return $Mime[$ext] }
  "application/octet-stream"
}

# --- Banner ---
Write-Host  ("Static server started.")
Write-Host  ("Root: {0}" -f $Root)

# --- Stop flag + Ctrl+C handler (best-effort) ---
$script:StopServer = $false
try {
  $handler = { $script:StopServer = $true; Write-Host ""; Write-Host "Stopping..." }
  [Console]::CancelKeyPress.Add($handler) | Out-Null
} catch {
  Write-Warning ("Ctrl+C handler not available: {0}" -f $_.Exception.Message)
}

# --- Start listeners (IPv4 + IPv6 loopback) ---
$started = @()
$listener4 = $null; $listener6 = $null
try {
  $listener4 = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
  $listener4.Server.NoDelay = $true
  $listener4.Start()
  $started += "127.0.0.1"
} catch { $listener4 = $null }

try {
  $listener6 = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("::1"), $Port)
  try { $listener6.Server.DualMode = $true } catch { }
  $listener6.Server.NoDelay = $true
  $listener6.Start()
  $started += "::1"
} catch { $listener6 = $null }

if ($started.Count -eq 0) {
  Write-Error "Failed to start IPv4/IPv6 listeners. Is the port busy or loopback blocked?"
  exit 2
}

Write-Host ("Listening on: {0}" -f ($started -join ", "))
Write-Host ("Check URLs:")
if ($started -contains "127.0.0.1") { Write-Host ("  http://127.0.0.1:{0}/" -f $Port) }
if ($started -contains "::1")       { Write-Host ("  http://[::1]:{0}/" -f $Port) }
Write-Host ("Address: http://{0}:{1}/" -f $Hostname, $Port)
Write-Host ("READY http://{0}:{1}/" -f $Hostname, $Port)
Write-Host "Press Ctrl+C to stop."

# --- HTTP helpers (ALWAYS use -f to avoid accidental formatting) ---
function Write-Headers {
  param(
    [System.IO.Stream]$Stream,
    [int]$Status, [string]$Message,
    [hashtable]$Headers, [int]$ContentLength
  )
  $w = New-Object System.IO.StreamWriter($Stream, [System.Text.Encoding]::ASCII, 1024, $true)
  $w.NewLine = "`r`n"
  $w.WriteLine(("HTTP/1.1 {0} {1}" -f $Status, $Message))
  $w.WriteLine("Server: Mask2077-PS/1.0")
  $w.WriteLine("Connection: close")
  $w.WriteLine(("Content-Length: {0}" -f $ContentLength))
  if ($Headers) { foreach($k in $Headers.Keys){ $w.WriteLine(("{0}: {1}" -f $k, $Headers[$k])) } }
  $w.WriteLine("")
  $w.Flush()
}

function Send-Bytes {
  param([System.IO.Stream]$Stream, [byte[]]$Bytes)
  if ($Bytes -and $Bytes.Length -gt 0) {
    $Stream.Write($Bytes, 0, $Bytes.Length)
    $Stream.Flush()
  }
}

# Read request up to \r\n\r\n (headers only), with timeout and limit
function Read-Request {
  param([System.Net.Sockets.TcpClient]$Client, [int]$HeaderLimit = 65536, [int]$TimeoutMs = 5000)
  $ns = $Client.GetStream()
  $ns.ReadTimeout  = $TimeoutMs
  $ns.WriteTimeout = $TimeoutMs
  $buf  = New-Object byte[] 4096
  $mem  = New-Object System.IO.MemoryStream
  $needle = [byte[]](13,10,13,10) # \r\n\r\n
  while ($true) {
    $read = $ns.Read($buf,0,$buf.Length)
    if ($read -le 0) { throw "client closed before headers" }
    $mem.Write($buf,0,$read)
    if ($mem.Length -gt $HeaderLimit) { throw ("headers too large (> {0})" -f $HeaderLimit) }
    # find \r\n\r\n
    $arr = $mem.ToArray()
    for ($i=[Math]::Max(0,$arr.Length-($read+$needle.Length)); $i -le $arr.Length-$needle.Length; $i++) {
      if ($arr[$i] -eq 13 -and $arr[$i+1] -eq 10 -and $arr[$i+2] -eq 13 -and $arr[$i+3] -eq 10) {
        $headerBytes = $arr[0..($i+3)]
        $remain = @()
        if ($i+4 -le $arr.Length-1) { $remain = $arr[($i+4)..($arr.Length-1)] }
        return ,@($headerBytes, $remain, $ns)
      }
    }
  }
}

function Parse-StartLineAndHeaders {
  param([byte[]]$HeaderBytes)
  $text  = [System.Text.Encoding]::ASCII.GetString($HeaderBytes)
  $lines = $text -split "`r?`n"
  $start = $lines[0]
  $hdr   = @{}
  for ($i=1; $i -lt $lines.Count; $i++) {
    if (-not $lines[$i]) { break }
    $j = $lines[$i].IndexOf(":")
    if ($j -gt 0) {
      $k = $lines[$i].Substring(0,$j).Trim()
      $v = $lines[$i].Substring($j+1).Trim()
      $hdr[$k] = $v
    }
  }
  return ,@($start, $hdr)
}

# --- Client handler ---
function Handle-Client([System.Net.Sockets.TcpClient]$client){
  try {
    $client.NoDelay = $true
    $client.ReceiveTimeout = 5000
    $client.SendTimeout    = 5000

    $res = Read-Request -Client $client
    $headerBytes = $res[0]; $remain = $res[1]; $ns = $res[2]
    $parsed = Parse-StartLineAndHeaders -HeaderBytes $headerBytes
    $requestLine = $parsed[0]; $headers = $parsed[1]

    if ($VerboseLog) { Write-Host (">> {0}" -f $requestLine) }
    $parts = $requestLine -split "\s+"
    if ($parts.Count -lt 2) { throw "bad request line" }

    $method = $parts[0].ToUpperInvariant()
    $urlRaw = $parts[1]
    if (($method -ne "GET") -and ($method -ne "HEAD")) {
      $msg  = [System.Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
      Write-Headers -Stream $ns -Status 405 -Message "Method Not Allowed" -Headers @{ "Allow"="GET, HEAD"; "Content-Type"="text/plain; charset=utf-8" } -ContentLength $msg.Length
      if ($method -ne "HEAD") { Send-Bytes -Stream $ns -Bytes $msg }
      return
    }

    # Health check (independent of files)
    if ($urlRaw -eq "/__health") {
      $body = [System.Text.Encoding]::UTF8.GetBytes("ok")
      Write-Headers -Stream $ns -Status 200 -Message "OK" -Headers @{ "Content-Type"="text/plain; charset=utf-8" } -ContentLength $body.Length
      if ($method -ne "HEAD") { Send-Bytes -Stream $ns -Bytes $body }
      return
    }

    # Normalize path
    $pathRaw = $urlRaw
    $fragmentIndex = $pathRaw.IndexOf("#")
    if ($fragmentIndex -ge 0) { $pathRaw = $pathRaw.Substring(0, $fragmentIndex) }
    $queryIndex = $pathRaw.IndexOf("?")
    if ($queryIndex -ge 0) { $pathRaw = $pathRaw.Substring(0, $queryIndex) }
    try { $path = [Uri]::UnescapeDataString($pathRaw) } catch { $path = $pathRaw }
    if ($path -eq "/") { $path = "/index.html" }

    $relative = $path.TrimStart("/")
    if ($relative -match "\.\.") { throw "path outside root is not allowed" }

    $fsPath = Join-Path $Root $relative
    if (Test-Path -LiteralPath $fsPath -PathType Container) {
      $fsPath = Join-Path $fsPath "index.html"
    }

    if (-not (Test-Path -LiteralPath $fsPath -PathType Leaf)) {
      if ($SpaFallback -and -not ([IO.Path]::GetExtension($relative))) {
        $fsPath = Join-Path $Root "index.html"
        if (-not (Test-Path -LiteralPath $fsPath -PathType Leaf)) {
          $msg = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
          Write-Headers -Stream $ns -Status 404 -Message "Not Found" -Headers @{ "Content-Type"="text/plain; charset=utf-8" } -ContentLength $msg.Length
          if ($method -ne "HEAD") { Send-Bytes -Stream $ns -Bytes $msg }
          return
        }
      } else {
        $msg = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        Write-Headers -Stream $ns -Status 404 -Message "Not Found" -Headers @{ "Content-Type"="text/plain; charset=utf-8" } -ContentLength $msg.Length
        if ($method -ne "HEAD") { Send-Bytes -Stream $ns -Bytes $msg }
        return
      }
    }

    $bytes = [IO.File]::ReadAllBytes($fsPath)
    $ctype = Get-ContentType $fsPath
    $hdrs = @{ "Content-Type"=$ctype; "Cache-Control"="no-cache, no-store, must-revalidate"; "Pragma"="no-cache"; "Expires"="0" }
    Write-Headers -Stream $ns -Status 200 -Message "OK" -Headers $hdrs -ContentLength $bytes.Length
    if ($method -ne "HEAD") { Send-Bytes -Stream $ns -Bytes $bytes }

    if ($VerboseLog) { Write-Host (("<< 200 {0} ({1} bytes)" -f $relative, $bytes.Length)) }

  } catch {
    $errText = $_.Exception.Message
    if ($VerboseLog) { Write-Warning ( "Request error: {0}" -f $errText ) }
    try {
      $ns = $client.GetStream()
      $body = [System.Text.Encoding]::UTF8.GetBytes("Internal Server Error")
      Write-Headers -Stream $ns -Status 500 -Message "Internal Server Error" -Headers @{ "Content-Type"="text/plain; charset=utf-8" } -ContentLength $body.Length
      Send-Bytes -Stream $ns -Bytes $body
    } catch { }
  } finally {
    try { $client.Close() } catch { }
  }
}

# --- Main loop ---
try {
  while (-not $script:StopServer) {
    $client = $null
    if ($listener4 -and $listener4.Pending())      { $client = $listener4.AcceptTcpClient() }
    elseif ($listener6 -and $listener6.Pending())   { $client = $listener6.AcceptTcpClient() }
    else { Start-Sleep -Milliseconds 15; continue }
    Handle-Client -client $client
  }
} finally {
  try { if ($listener4){ $listener4.Stop() } } catch { }
  try { if ($listener6){ $listener6.Stop() } } catch { }
  Write-Host "Server stopped."
}
