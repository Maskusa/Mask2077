$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing | Out-Null

$code = @'
using System;
using System.Diagnostics;
using System.Linq;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Security.Principal;

public static class WinInetHelper
{
    [DllImport("wininet.dll", SetLastError = true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);

    public static void Refresh()
    {
        InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0);
    }
}

public class ProxyControlForm : Form
{
    private TextBox host;
    private NumericUpDown httpPort;
    private NumericUpDown socksPort;
    private TextBox user;
    private TextBox pass;
    private TextBox status;
    private Label statsValue;
    private Label pingValue;
    private Label uptimeLabel;
    private Timer statsTimer;
    private Button enableButton;
    private Button disableButton;
    private readonly bool hasAdmin;

    private DateTime? connectionStart;
    private NetStats baseline;
    private DateTime lastSample;

    private const string MessageEnableAdmin = "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 ProxyControl \u043E\u0442 \u0438\u043C\u0435\u043D\u0438 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430, \u0447\u0442\u043E\u0431\u044B \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043F\u0440\u043E\u043A\u0441\u0438.";
    private const string MessageDisableAdmin = "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 ProxyControl \u043E\u0442 \u0438\u043C\u0435\u043D\u0438 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043F\u0440\u043E\u043A\u0441\u0438.";
    private const string WarningText = "\u0412\u043D\u0438\u043C\u0430\u043D\u0438\u0435: \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0437\u0430\u043F\u0443\u0449\u0435\u043D\u043E \u0431\u0435\u0437 \u043F\u0440\u0430\u0432 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430. \u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u043A\u0441\u0438 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E.";

    private class NetStats
    {
        public double StartSent;
        public double StartReceived;
        public double LastSent;
        public double LastReceived;
        public NetStats(double sent, double received)
        {
            StartSent = sent;
            StartReceived = received;
            LastSent = sent;
            LastReceived = received;
        }
    }

    private class Snapshot
    {
        public double Sent;
        public double Received;
        public Snapshot(double sent, double received)
        {
            Sent = sent;
            Received = received;
        }
    }

    public ProxyControlForm()
    {
        Text = "Proxy Control";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new System.Drawing.Size(520, 470);

        hasAdmin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        if (!hasAdmin)
        {
            if (PromptElevation())
            {
                try
                {
                    var psi = new ProcessStartInfo(Application.ExecutablePath)
                    {
                        UseShellExecute = true,
                        Verb = "runas"
                    };
                    Process.Start(psi);
                }
                catch
                {
                }
                Environment.Exit(0);
                return;
            }
        }

        host = CreateTextBox("Host", "45.151.183.153", 20);
        httpPort = CreateNumeric("HTTP port", 60, 8080);
        socksPort = CreateNumeric("SOCKS port", 100, 1080);
        user = CreateTextBox("Username", "masku", 140);
        pass = CreateTextBox("Password", "superproxy123", 180);
        pass.UseSystemPasswordChar = true;

        enableButton = new Button { Text = "Enable proxy", Location = new System.Drawing.Point(370, 20), Size = new System.Drawing.Size(120, 36) };
        enableButton.Click += (s, e) => EnableClicked();
        Controls.Add(enableButton);

        disableButton = new Button { Text = "Disable proxy", Location = new System.Drawing.Point(370, 62), Size = new System.Drawing.Size(120, 36) };
        disableButton.Click += (s, e) => DisableClicked();
        Controls.Add(disableButton);

        var btnStatus = new Button { Text = "Refresh status", Location = new System.Drawing.Point(370, 104), Size = new System.Drawing.Size(120, 36) };
        btnStatus.Click += (s, e) => { ShowStatus(); RefreshPing(); };
        Controls.Add(btnStatus);

        CreateLabel("Current status", 20, 210);
        status = new TextBox
        {
            Location = new System.Drawing.Point(20, 230),
            Size = new System.Drawing.Size(470, 170),
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Font = new System.Drawing.Font("Consolas", 9f)
        };
        Controls.Add(status);

        statsValue = new Label { Location = new System.Drawing.Point(20, 410), AutoSize = true };
        Controls.Add(statsValue);

        var pingButton = new Button { Text = "\u21C4", Location = new System.Drawing.Point(430, 406), Size = new System.Drawing.Size(30, 24) };
        pingButton.Click += (s, e) => RefreshPing();
        Controls.Add(pingButton);

        pingValue = new Label { Location = new System.Drawing.Point(370, 410), AutoSize = true };
        Controls.Add(pingValue);

        uptimeLabel = new Label { Location = new System.Drawing.Point(20, 440), AutoSize = true };
        Controls.Add(uptimeLabel);

        statsTimer = new Timer { Interval = 5000 };
        statsTimer.Tick += (s, e) => UpdateStats();

        ShowStatus();

        if (!hasAdmin)
        {
            status.AppendText(Environment.NewLine + WarningText);
            enableButton.Enabled = false;
            disableButton.Enabled = false;
        }
    }

    private TextBox CreateTextBox(string caption, string value, int top)
    {
        CreateLabel(caption, 20, top + 4);
        var tb = new TextBox { Location = new System.Drawing.Point(150, top), Size = new System.Drawing.Size(200, 24), Text = value };
        Controls.Add(tb);
        return tb;
    }

    private NumericUpDown CreateNumeric(string caption, int top, int value)
    {
        CreateLabel(caption, 20, top + 4);
        var num = new NumericUpDown { Location = new System.Drawing.Point(150, top), Minimum = 1, Maximum = 65535, Value = value, Size = new System.Drawing.Size(200, 24) };
        Controls.Add(num);
        return num;
    }

    private void CreateLabel(string text, int x, int y)
    {
        var lbl = new Label { Text = text, Location = new System.Drawing.Point(x, y), AutoSize = true };
        Controls.Add(lbl);
    }

    private bool PromptElevation()
    {
        using (var dialog = new Form())
        {
            dialog.Text = "Proxy Control";
            dialog.StartPosition = FormStartPosition.CenterScreen;
            dialog.FormBorderStyle = FormBorderStyle.FixedDialog;
            dialog.MaximizeBox = false;
            dialog.MinimizeBox = false;
            dialog.ClientSize = new System.Drawing.Size(360, 150);

            var label = new Label
            {
                Text = "ProxyControl \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0440\u0430\u0432 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430 \u0434\u043B\u044F \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A.",
                Location = new System.Drawing.Point(12, 15),
                Size = new System.Drawing.Size(336, 50),
                AutoSize = false
            };
            dialog.Controls.Add(label);

            var ok = new Button
            {
                Text = "\u0412\u043E\u0439\u0442\u0438",
                DialogResult = DialogResult.OK,
                Location = new System.Drawing.Point(60, 90),
                Size = new System.Drawing.Size(100, 30)
            };
            dialog.Controls.Add(ok);

            var skip = new Button
            {
                Text = "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C",
                DialogResult = DialogResult.Cancel,
                Location = new System.Drawing.Point(200, 90),
                Size = new System.Drawing.Size(100, 30)
            };
            dialog.Controls.Add(skip);

            dialog.AcceptButton = ok;
            dialog.CancelButton = skip;

            return dialog.ShowDialog() == DialogResult.OK;
        }
    }

    private void EnableClicked()
    {
        if (!hasAdmin)
        {
            MessageBox.Show(MessageEnableAdmin, "Proxy Control", MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
            return;
        }
        try
        {
            SetSystemProxy(host.Text.Trim(), (int)socksPort.Value, (int)httpPort.Value, user.Text, pass.Text);
            StartConnection();
            ShowStatus();
            MessageBox.Show("Proxy enabled", "Status", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void DisableClicked()
    {
        if (!hasAdmin)
        {
            MessageBox.Show(MessageDisableAdmin, "Proxy Control", MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
            return;
        }
        try
        {
            DisableSystemProxy(host.Text.Trim(), (int)httpPort.Value);
            StopConnection();
            ShowStatus();
            MessageBox.Show("Proxy disabled", "Status", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void SetSystemProxy(string hostValue, int socks, int http, string userValue, string passValue)
    {
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true))
        {
            key.SetValue("ProxyEnable", 1, RegistryValueKind.DWord);
            key.SetValue("ProxyServer", string.Format("{0}:{1}", hostValue, http), RegistryValueKind.String);
            key.SetValue("ProxyOverride", "<local>", RegistryValueKind.String);
        }

        WinInetHelper.Refresh();

        string httpUrl = string.Format("http://{0}:{1}@{2}:{3}", userValue, passValue, hostValue, http);
        string socksUrl = string.Format("socks5://{0}:{1}@{2}:{3}", userValue, passValue, hostValue, socks);
        Environment.SetEnvironmentVariable("http_proxy", httpUrl, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable("https_proxy", httpUrl, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable("all_proxy", socksUrl, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable("NO_PROXY", "localhost,127.0.0.1", EnvironmentVariableTarget.User);

        RunCmd("/c chcp 65001>nul & netsh winhttp set proxy " + hostValue + ":" + http);
        foreach (var scheme in new[] { "HTTP://", "HTTPS://" })
        {
            RunCmd(string.Format("/c cmdkey /generic:{0}{1}:{2} /user:{3} /pass:{4}", scheme, hostValue, http, userValue, passValue));
        }
    }

    private void DisableSystemProxy(string hostValue, int http)
    {
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true))
        {
            key.SetValue("ProxyEnable", 0, RegistryValueKind.DWord);
            key.DeleteValue("ProxyServer", false);
            key.DeleteValue("ProxyOverride", false);
        }

        WinInetHelper.Refresh();

        Environment.SetEnvironmentVariable("http_proxy", string.Empty, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable("https_proxy", string.Empty, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable("all_proxy", string.Empty, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable("NO_PROXY", string.Empty, EnvironmentVariableTarget.User);

        RunCmd("/c chcp 65001>nul & netsh winhttp reset proxy");
        foreach (var scheme in new[] { "HTTP://", "HTTPS://" })
        {
            RunCmd(string.Format("/c cmdkey /delete:{0}{1}:{2}", scheme, hostValue, http));
        }
    }

    private void RunCmd(string arguments)
    {
        var psi = new ProcessStartInfo("cmd.exe", arguments)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8
        };
        using (var proc = Process.Start(psi))
        {
            proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
        }
    }

    private void ShowStatus()
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", false))
            {
                object enabledObj = key.GetValue("ProxyEnable", 0);
                int enabled = enabledObj is int ? (int)enabledObj : 0;
                object serverObj = key.GetValue("ProxyServer", string.Empty);
                string server = serverObj as string ?? string.Empty;
                status.Text = string.Format(
                    "WinINet: {0}{1}Server : {2}{1}WinHTTP: {3}{1}Environment:{1}{4}",
                    enabled == 1 ? "enabled" : "disabled",
                    Environment.NewLine,
                    string.IsNullOrWhiteSpace(server) ? "-" : server,
                    GetWinHttpText(),
                    BuildEnvBlock());
            }
        }
        catch (Exception ex)
        {
            status.Text = ex.Message;
        }
        UpdateStats();
    }

    private string BuildEnvBlock()
    {
        var names = new[] { "http_proxy", "https_proxy", "all_proxy", "NO_PROXY" };
        var sb = new StringBuilder();
        foreach (var name in names)
        {
            var value = Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User);
            if (string.IsNullOrEmpty(value)) value = "-";
            sb.AppendLine(string.Format("{0}={1}", name, value));
        }
        return sb.ToString().TrimEnd();
    }

    private string GetWinHttpText()
    {
        return GetWinHttpOutput().Trim();
    }

    private string GetWinHttpOutput()
    {
        var psi = new ProcessStartInfo("cmd.exe", "/c chcp 65001>nul & netsh winhttp show proxy")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8
        };
        using (var proc = Process.Start(psi))
        {
            string text = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
            return text;
        }
    }

    private void StartConnection()
    {
        connectionStart = DateTime.UtcNow;
        var stats = GetPrimaryStats();
        if (stats != null)
        {
            baseline = new NetStats(stats.Sent, stats.Received);
        }
        else
        {
            baseline = null;
        }
        lastSample = DateTime.UtcNow;
        statsTimer.Start();
        UpdateStats();
        RefreshPing();
    }

    private void StopConnection()
    {
        statsTimer.Stop();
        connectionStart = null;
        baseline = null;
        statsValue.Text = string.Empty;
        pingValue.Text = string.Empty;
        uptimeLabel.Text = string.Empty;
    }

    private void UpdateStats()
    {
        if (connectionStart == null)
        {
            statsValue.Text = string.Empty;
            pingValue.Text = string.Empty;
            uptimeLabel.Text = string.Empty;
            return;
        }

        var stats = GetPrimaryStats();
        if (stats == null)
        {
            return;
        }

        if (baseline == null)
        {
            baseline = new NetStats(stats.Sent, stats.Received);
            lastSample = DateTime.UtcNow;
        }

        double totalSent = stats.Sent - baseline.StartSent;
        double totalReceived = stats.Received - baseline.StartReceived;
        string text = string.Format("Sent {0} / Rec {1}", FormatBytes(totalSent), FormatBytes(totalReceived));

        double deltaSeconds = (DateTime.UtcNow - lastSample).TotalSeconds;
        if (deltaSeconds >= 1)
        {
            double rateSent = (stats.Sent - baseline.LastSent) / deltaSeconds;
            double rateReceived = (stats.Received - baseline.LastReceived) / deltaSeconds;
            baseline.LastSent = stats.Sent;
            baseline.LastReceived = stats.Received;
            lastSample = DateTime.UtcNow;
            text += string.Format("  BW: UP{0}/s DN{1}/s", FormatBytes(rateSent), FormatBytes(rateReceived));
        }

        statsValue.Text = text;
        uptimeLabel.Text = "Connection time: " + (DateTime.UtcNow - connectionStart.Value).ToString(@"hh\:mm\:ss");
    }

    private Snapshot GetPrimaryStats()
    {
        try
        {
            var iface = NetworkInterface
                .GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up)
                .OrderByDescending(n => n.GetIPStatistics().BytesReceived)
                .FirstOrDefault();
            if (iface == null) return null;
            var ipStats = iface.GetIPStatistics();
            return new Snapshot(ipStats.BytesSent, ipStats.BytesReceived);
        }
        catch
        {
            return null;
        }
    }

    private void RefreshPing()
    {
        if (connectionStart == null) return;
        try
        {
            using (var ping = new Ping())
            {
                var reply = ping.Send(host.Text.Trim(), 2000);
                if (reply.Status == IPStatus.Success)
                {
                    pingValue.Text = "Ping " + reply.RoundtripTime + " ms";
                }
                else
                {
                    pingValue.Text = "Ping failed";
                }
            }
        }
        catch
        {
            pingValue.Text = "Ping failed";
        }
    }

    private static string FormatBytes(double value)
    {
        string[] units = { "BT", "KB", "MB", "GB" };
        int idx = 0;
        while (value >= 1024 && idx < units.Length - 1)
        {
            value /= 1024;
            idx++;
        }
        return string.Format("{0,4:0.#} {1}", value, units[idx]);
    }

    [STAThread]
    public static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ProxyControlForm());
    }
}
'@

$output = Join-Path $PSScriptRoot 'ProxyControl.exe'
Write-Host "Building ProxyControl.exe..."
$compilerParams = New-Object System.CodeDom.Compiler.CompilerParameters
$compilerParams.CompilerOptions = '/target:winexe'
$compilerParams.GenerateExecutable = $true
$compilerParams.GenerateInMemory = $false
$compilerParams.OutputAssembly = $output
$null = $compilerParams.ReferencedAssemblies.Add('System.Windows.Forms.dll')
$null = $compilerParams.ReferencedAssemblies.Add('System.Drawing.dll')
$null = $compilerParams.ReferencedAssemblies.Add('System.Net.NetworkInformation.dll')
$null = $compilerParams.ReferencedAssemblies.Add('System.Core.dll')
$null = $compilerParams.ReferencedAssemblies.Add('System.dll')
Add-Type -CompilerParameters $compilerParams $code
Write-Host "Ready: $output"
