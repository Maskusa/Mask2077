Add-Type -AssemblyName System.Windows.Forms,System.Drawing | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()

if (-not ([System.Management.Automation.PSTypeName]'WinInetBridge.Helper').Type) {
    Add-Type -Namespace WinInetBridge -Name Helper -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Helper {
    [DllImport("wininet.dll", SetLastError = true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@ -PassThru | Out-Null
}

function Invoke-WinInetRefresh {
    [WinInetBridge.Helper]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0) | Out-Null
    [WinInetBridge.Helper]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0) | Out-Null
}

function Invoke-Cmd {
    param([string]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $proc = [System.Diagnostics.Process]::Start($psi)
    try {
        $null = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit()
    } finally {
        $proc.Close()
    }
}

function Set-SystemProxy {
    param(
        [string]$Host,
        [int]$SocksPort,
        [int]$HttpPort,
        [string]$Username,
        [string]$Password
    )
    $path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    Set-ItemProperty -Path $path -Name ProxyEnable -Value 1 -Type DWord
    Set-ItemProperty -Path $path -Name ProxyServer -Value "$Host`:$HttpPort" -Type String
    Set-ItemProperty -Path $path -Name ProxyOverride -Value '<local>' -Type String
    Invoke-WinInetRefresh

    $httpUrl = "http://$Username`:$Password@$Host`:$HttpPort"
    $socksUrl = "socks5://$Username`:$Password@$Host`:$SocksPort"
    [Environment]::SetEnvironmentVariable('http_proxy',$httpUrl,'User')
    [Environment]::SetEnvironmentVariable('https_proxy',$httpUrl,'User')
    [Environment]::SetEnvironmentVariable('all_proxy',$socksUrl,'User')
    [Environment]::SetEnvironmentVariable('NO_PROXY','localhost,127.0.0.1','User')

    Invoke-Cmd "/c chcp 65001>nul & netsh winhttp set proxy $Host`:$HttpPort"
    foreach ($scheme in 'HTTP://','HTTPS://') {
        Invoke-Cmd "/c cmdkey /generic:$scheme$Host`:$HttpPort /user:$Username /pass:$Password"
    }
}

function Disable-SystemProxy {
    param([string]$Host,[int]$HttpPort)
    $path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    Set-ItemProperty -Path $path -Name ProxyEnable -Value 0 -Type DWord
    Remove-ItemProperty -Path $path -Name ProxyServer -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $path -Name ProxyOverride -ErrorAction SilentlyContinue
    Invoke-WinInetRefresh

    [Environment]::SetEnvironmentVariable('http_proxy','', 'User')
    [Environment]::SetEnvironmentVariable('https_proxy','', 'User')
    [Environment]::SetEnvironmentVariable('all_proxy','', 'User')
    [Environment]::SetEnvironmentVariable('NO_PROXY','', 'User')

    Invoke-Cmd '/c chcp 65001>nul & netsh winhttp reset proxy'
    foreach ($scheme in 'HTTP://','HTTPS://') {
        Invoke-Cmd "/c cmdkey /delete:$scheme$Host`:$HttpPort"
    }
}

function Get-WinHttpText {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = '/c chcp 65001>nul & netsh winhttp show proxy'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $proc = [System.Diagnostics.Process]::Start($psi)
    try {
        $text = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit()
        return $text.Trim()
    } finally {
        $proc.Close()
    }
}

function Get-ProxyStatus {
    $path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    $enabled = 0
    $server = ''
    try { $enabled = (Get-ItemProperty -Path $path -Name ProxyEnable -ErrorAction Stop).ProxyEnable } catch { }
    try { $server = (Get-ItemProperty -Path $path -Name ProxyServer -ErrorAction Stop).ProxyServer } catch { }
    $envNames = 'http_proxy','https_proxy','all_proxy','NO_PROXY'
    $envBlock = ($envNames | ForEach-Object {
        $value = [Environment]::GetEnvironmentVariable($_,'User')
        if ([string]::IsNullOrEmpty($value)) { $value = '-' }
        "$_=$value"
    }) -join [Environment]::NewLine
    [PSCustomObject]@{
        WinINetEnabled = if ($enabled -eq 1) { 'enabled' } else { 'disabled' }
        WinINetServer  = if ($server) { $server } else { '-' }
        WinHttp        = Get-WinHttpText
        Env            = $envBlock
    }
}

function Get-PrimaryStats {
    try {
        $interfaces = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            Where-Object { $_.OperationalStatus -eq [System.Net.NetworkInformation.OperationalStatus]::Up }
        $iface = $interfaces |
            Sort-Object { $_.GetIPStatistics().BytesReceived } -Descending |
            Select-Object -First 1
        if (-not $iface) { return $null }
        $stats = $iface.GetIPStatistics()
        return [PSCustomObject]@{ Sent = [double]$stats.BytesSent; Received = [double]$stats.BytesReceived }
    } catch { return $null }
}

function Format-Bytes {
    param([double]$Value)
    $units = @('BT','KB','MB','GB')
    $idx = 0
    while ($Value -ge 1024 -and $idx -lt $units.Length - 1) {
        $Value /= 1024
        $idx++
    }
    return ('{0,4:0.#} {1}' -f $Value, $units[$idx])
}

function Get-UnicodeString {
    param([int[]]$Codepoints)
    return -join ($Codepoints | ForEach-Object { [char]$_ })
}

function Show-ElevationPrompt {
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = 'Proxy Control'
    $dialog.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $dialog.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.ClientSize = New-Object System.Drawing.Size(360,150)

    $label = New-Object System.Windows.Forms.Label
    $label.Text = 'ProxyControl ' + (Get-UnicodeString 0x0442,0x0440,0x0435,0x0431,0x0443,0x0435,0x0442,0x0020,0x043F,0x0440,0x0430,0x0432,0x0020,0x0430,0x0434,0x043C,0x0438,0x043D,0x0438,0x0441,0x0442,0x0440,0x0430,0x0442,0x043E,0x0440,0x0430,0x0020,0x0434,0x043B,0x044F,0x0020,0x043F,0x0440,0x0438,0x043C,0x0435,0x043D,0x0435,0x043D,0x0438,0x044F,0x0020,0x043D,0x0430,0x0441,0x0442,0x0440,0x043E,0x0435,0x043A,0x002E)
    $label.Location = New-Object System.Drawing.Point(12,15)
    $label.Size = New-Object System.Drawing.Size(336,50)
    $label.AutoSize = $false
    $dialog.Controls.Add($label) | Out-Null

    $buttonElevate = New-Object System.Windows.Forms.Button
    $buttonElevate.Text = Get-UnicodeString 0x0412,0x043E,0x0439,0x0442,0x0438
    $buttonElevate.Location = New-Object System.Drawing.Point(60,90)
    $buttonElevate.Size = New-Object System.Drawing.Size(100,30)
    $buttonElevate.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $dialog.Controls.Add($buttonElevate) | Out-Null

    $buttonContinue = New-Object System.Windows.Forms.Button
    $buttonContinue.Text = Get-UnicodeString 0x041F,0x0440,0x043E,0x0434,0x043E,0x043B,0x0436,0x0438,0x0442,0x044C
    $buttonContinue.Location = New-Object System.Drawing.Point(200,90)
    $buttonContinue.Size = New-Object System.Drawing.Size(100,30)
    $buttonContinue.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $dialog.Controls.Add($buttonContinue) | Out-Null

    $dialog.AcceptButton = $buttonElevate
    $dialog.CancelButton = $buttonContinue

    $result = $dialog.ShowDialog()
    $dialog.Dispose()
    return $result -eq [System.Windows.Forms.DialogResult]::OK
}

$hasAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $hasAdmin) {
    if (Show-ElevationPrompt) {
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = [System.Windows.Forms.Application]::ExecutablePath
            $psi.UseShellExecute = $true
            $psi.Verb = 'runas'
            [System.Diagnostics.Process]::Start($psi) | Out-Null
        } catch { }
        return
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Proxy Control'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object System.Drawing.Size(520,470)

function New-Label {
    param([string]$Text,[int]$X,[int]$Y)
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $Text
    $lbl.Location = New-Object System.Drawing.Point($X,$Y)
    $lbl.AutoSize = $true
    $form.Controls.Add($lbl) | Out-Null
    return $lbl
}

function New-TextBox {
    param([string]$Caption,[string]$Value,[int]$Top)
    New-Label -Text $Caption -X 20 -Y ($Top + 4) | Out-Null
    $tb = New-Object System.Windows.Forms.TextBox
    $tb.Location = New-Object System.Drawing.Point(150,$Top)
    $tb.Size = New-Object System.Drawing.Size(200,24)
    $tb.Text = $Value
    $form.Controls.Add($tb) | Out-Null
    return $tb
}

function New-Numeric {
    param([string]$Caption,[int]$Top,[int]$Value)
    New-Label -Text $Caption -X 20 -Y ($Top + 4) | Out-Null
    $num = New-Object System.Windows.Forms.NumericUpDown
    $num.Location = New-Object System.Drawing.Point(150,$Top)
    $num.Size = New-Object System.Drawing.Size(200,24)
    $num.Minimum = 1
    $num.Maximum = 65535
    $num.Value = $Value
    $form.Controls.Add($num) | Out-Null
    return $num
}

$hostBox = New-TextBox -Caption 'Host' -Value '45.151.183.153' -Top 20
$httpPortBox = New-Numeric -Caption 'HTTP port' -Top 60 -Value 8080
$socksPortBox = New-Numeric -Caption 'SOCKS port' -Top 100 -Value 1080
$userBox = New-TextBox -Caption 'Username' -Value 'masku' -Top 140
$passBox = New-TextBox -Caption 'Password' -Value 'superproxy123' -Top 180
$passBox.UseSystemPasswordChar = $true

$enableButton = New-Object System.Windows.Forms.Button
$enableButton.Text = 'Enable proxy'
$enableButton.Location = New-Object System.Drawing.Point(370,20)
$enableButton.Size = New-Object System.Drawing.Size(120,36)
$form.Controls.Add($enableButton) | Out-Null

$disableButton = New-Object System.Windows.Forms.Button
$disableButton.Text = 'Disable proxy'
$disableButton.Location = New-Object System.Drawing.Point(370,62)
$disableButton.Size = New-Object System.Drawing.Size(120,36)
$form.Controls.Add($disableButton) | Out-Null

$statusButton = New-Object System.Windows.Forms.Button
$statusButton.Text = 'Refresh status'
$statusButton.Location = New-Object System.Drawing.Point(370,104)
$statusButton.Size = New-Object System.Drawing.Size(120,36)
$form.Controls.Add($statusButton) | Out-Null

New-Label -Text 'Current status' -X 20 -Y 210 | Out-Null
$statusBox = New-Object System.Windows.Forms.TextBox
$statusBox.Location = New-Object System.Drawing.Point(20,230)
$statusBox.Size = New-Object System.Drawing.Size(470,170)
$statusBox.Multiline = $true
$statusBox.ReadOnly = $true
$statusBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$statusBox.Font = New-Object System.Drawing.Font('Consolas',9)
$form.Controls.Add($statusBox) | Out-Null

$statsLabel = New-Object System.Windows.Forms.Label
$statsLabel.Location = New-Object System.Drawing.Point(20,410)
$statsLabel.AutoSize = $true
$form.Controls.Add($statsLabel) | Out-Null

$pingLabel = New-Object System.Windows.Forms.Label
$pingLabel.Location = New-Object System.Drawing.Point(370,410)
$pingLabel.AutoSize = $true
$form.Controls.Add($pingLabel) | Out-Null

$pingButton = New-Object System.Windows.Forms.Button
$pingButton.Text = [char]0x21C4
$pingButton.Location = New-Object System.Drawing.Point(430,406)
$pingButton.Size = New-Object System.Drawing.Size(30,24)
$form.Controls.Add($pingButton) | Out-Null

$uptimeLabel = New-Object System.Windows.Forms.Label
$uptimeLabel.Location = New-Object System.Drawing.Point(20,440)
$uptimeLabel.AutoSize = $true
$form.Controls.Add($uptimeLabel) | Out-Null

$statsTimer = New-Object System.Windows.Forms.Timer
$statsTimer.Interval = 5000

$script:connectionStart = $null
$script:baseline = $null
$script:lastSample = [DateTime]::UtcNow

function Update-Stats {
    if (-not $script:connectionStart) {
        $statsLabel.Text = ''
        $pingLabel.Text = ''
        $uptimeLabel.Text = ''
        return
    }
    $stats = Get-PrimaryStats
    if (-not $stats) { return }
    if (-not $script:baseline) {
        $script:baseline = @{
            StartSent = $stats.Sent
            StartReceived = $stats.Received
            LastSent = $stats.Sent
            LastReceived = $stats.Received
        }
        $script:lastSample = [DateTime]::UtcNow
    }
    $totalSent = $stats.Sent - $script:baseline.StartSent
    $totalReceived = $stats.Received - $script:baseline.StartReceived
    $text = 'Sent {0} / Rec {1}' -f (Format-Bytes $totalSent),(Format-Bytes $totalReceived)
    $delta = ([DateTime]::UtcNow - $script:lastSample).TotalSeconds
    if ($delta -ge 1) {
        $rateUp = ($stats.Sent - $script:baseline.LastSent) / $delta
        $rateDown = ($stats.Received - $script:baseline.LastReceived) / $delta
        $script:baseline.LastSent = $stats.Sent
        $script:baseline.LastReceived = $stats.Received
        $script:lastSample = [DateTime]::UtcNow
        $text += '  BW: UP{0}/s DN{1}/s' -f (Format-Bytes $rateUp),(Format-Bytes $rateDown)
    }
    $statsLabel.Text = $text
    $uptimeLabel.Text = 'Connection time: ' + ([DateTime]::UtcNow - $script:connectionStart).ToString('hh\:mm\:ss')
}

$statsTimer.add_Tick({ Update-Stats })

function Refresh-Ping {
    if (-not $script:connectionStart) { return }
    try {
        $ping = New-Object System.Net.NetworkInformation.Ping
        $reply = $ping.Send($hostBox.Text.Trim(),2000)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
            $pingLabel.Text = "Ping $($reply.RoundtripTime) ms"
        } else {
            $pingLabel.Text = 'Ping failed'
        }
    } catch {
        $pingLabel.Text = 'Ping failed'
    }
}

function Show-Status {
    try {
        $status = Get-ProxyStatus
        $statusBox.Text = "WinINet: $($status.WinINetEnabled)$([Environment]::NewLine)Server : $($status.WinINetServer)$([Environment]::NewLine)WinHTTP: $([Environment]::NewLine)$($status.WinHttp)$([Environment]::NewLine)Environment:$([Environment]::NewLine)$($status.Env)"
    } catch {
        $statusBox.Text = $_.Exception.Message
    }
    Update-Stats
}

function Start-Connection {
    $script:connectionStart = [DateTime]::UtcNow
    $current = Get-PrimaryStats
    if ($current) {
        $script:baseline = @{
            StartSent = $current.Sent
            StartReceived = $current.Received
            LastSent = $current.Sent
            LastReceived = $current.Received
        }
    } else {
        $script:baseline = $null
    }
    $script:lastSample = [DateTime]::UtcNow
    $statsTimer.Start()
    Update-Stats
    Refresh-Ping
}

function Stop-Connection {
    $statsTimer.Stop()
    $script:connectionStart = $null
    $script:baseline = $null
    $statsLabel.Text = ''
    $pingLabel.Text = ''
    $uptimeLabel.Text = ''
}

$msgEnableAdmin = Get-UnicodeString 0x0417,0x0430,0x043F,0x0443,0x0441,0x0442,0x0438,0x0442,0x0435,0x0020,0x0050,0x0072,0x006F,0x0078,0x0079,0x0043,0x006F,0x006E,0x0074,0x0072,0x006F,0x006C,0x0020,0x043E,0x0442,0x0020,0x0438,0x043C,0x0435,0x043D,0x0438,0x0020,0x0430,0x0434,0x043C,0x0438,0x043D,0x0438,0x0441,0x0442,0x0440,0x0430,0x0442,0x043E,0x0440,0x0430,0x002C,0x0020,0x0447,0x0442,0x043E,0x0431,0x044B,0x0020,0x0432,0x043A,0x043B,0x044E,0x0447,0x0438,0x0442,0x044C,0x0020,0x043F,0x0440,0x043E,0x043A,0x0441,0x0438,0x002E
$msgDisableAdmin = Get-UnicodeString 0x0417,0x0430,0x043F,0x0443,0x0441,0x0442,0x0438,0x0442,0x0435,0x0020,0x0050,0x0072,0x006F,0x0078,0x0079,0x0043,0x006F,0x006E,0x0074,0x0072,0x006F,0x006C,0x0020,0x043E,0x0442,0x0020,0x0438,0x043C,0x0435,0x043D,0x0438,0x0020,0x0430,0x0434,0x043C,0x0438,0x043D,0x0438,0x0441,0x0442,0x0440,0x0430,0x0442,0x043E,0x0440,0x0430,0x002C,0x0020,0x0447,0x0442,0x043E,0x0431,0x044B,0x0020,0x043E,0x0442,0x043A,0x043B,0x044E,0x0447,0x0438,0x0442,0x044C,0x0020,0x043F,0x0440,0x043E,0x043A,0x0441,0x0438,0x002E
$warningText = Get-UnicodeString 0x0412,0x043D,0x0438,0x043C,0x0430,0x043D,0x0438,0x0435,0x003A,0x0020,0x043F,0x0440,0x0438,0x043B,0x043E,0x0436,0x0435,0x043D,0x0438,0x0435,0x0020,0x0437,0x0430,0x043F,0x0443,0x0449,0x0435,0x043D,0x043E,0x0020,0x0431,0x0435,0x0437,0x0020,0x043F,0x0440,0x0430,0x0432,0x0020,0x0430,0x0434,0x043C,0x0438,0x043D,0x0438,0x0441,0x0442,0x0440,0x0430,0x0442,0x043E,0x0440,0x0430,0x002E,0x0020,0x0423,0x043F,0x0440,0x0430,0x0432,0x043B,0x0435,0x043D,0x0438,0x0435,0x0020,0x043F,0x0440,0x043E,0x043A,0x0441,0x0438,0x0020,0x043E,0x0442,0x043A,0x043B,0x044E,0x0447,0x0435,0x043D,0x043E,0x002E

$enableButton.Add_Click({
    if (-not $hasAdmin) {
        [System.Windows.Forms.MessageBox]::Show($msgEnableAdmin,'Proxy Control',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Exclamation) | Out-Null
        return
    }
    try {
        Set-SystemProxy -Host $hostBox.Text.Trim() -SocksPort [int]$socksPortBox.Value -HttpPort [int]$httpPortBox.Value -Username $userBox.Text -Password $passBox.Text
        Start-Connection
        Show-Status
        [System.Windows.Forms.MessageBox]::Show('Proxy enabled','Status',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Error',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
})

$disableButton.Add_Click({
    if (-not $hasAdmin) {
        [System.Windows.Forms.MessageBox]::Show($msgDisableAdmin,'Proxy Control',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Exclamation) | Out-Null
        return
    }
    try {
        Disable-SystemProxy -Host $hostBox.Text.Trim() -HttpPort [int]$httpPortBox.Value
        Stop-Connection
        Show-Status
        [System.Windows.Forms.MessageBox]::Show('Proxy disabled','Status',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Error',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
})

$statusButton.Add_Click({ Show-Status; Refresh-Ping })
$pingButton.Add_Click({ Refresh-Ping })

Show-Status

if (-not $hasAdmin) {
    $statusBox.AppendText([Environment]::NewLine + $warningText)
    $enableButton.Enabled = $false
    $disableButton.Enabled = $false
}

[System.Windows.Forms.Application]::Run($form)
