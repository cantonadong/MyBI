using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class MyBI
{
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    internal const string Url = "http://127.0.0.1:8000";
    static Dictionary<string, string> english;

    internal static string T(string value)
    {
        return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh" || !english.ContainsKey(value) ? value : english[value];
    }

    [STAThread]
    static void Main()
    {
        bool first;
        using (var mutex = new Mutex(true, "Local\\MyBI-" + Root.Replace('\\', '_').Replace(':', '_'), out first))
        {
            if (!first) { Process.Start(Url); return; }
            Application.EnableVisualStyles();
            english = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(File.ReadAllText(Path.Combine(Root, "frontend", "src", "locales", "en.json")));
            using (var tray = new ServiceTray()) Application.Run(tray);
        }
    }
}

sealed class ServiceTray : ApplicationContext
{
    readonly NotifyIcon icon;
    readonly Icon appIcon;
    readonly ContextMenuStrip menu = new ContextMenuStrip();
    readonly ToolStripMenuItem status = new ToolStripMenuItem();
    readonly ToolStripMenuItem stop;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    Process launcher;
    int serverPid;

    public ServiceTray()
    {
        appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        icon = new NotifyIcon { Icon = appIcon, Text = "MyBI", ContextMenuStrip = menu, Visible = true };
        status.Enabled = false;
        menu.Items.Add(status);
        menu.Items.Add(MyBI.T("打开 MyBI"), null, delegate { Process.Start(MyBI.Url); });
        menu.Items.Add(MyBI.T("启动服务"), null, delegate { StartService(); });
        stop = new ToolStripMenuItem(MyBI.T("停止服务"), null, delegate { StopService(); });
        menu.Items.Add(stop);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(MyBI.T("退出 MyBI"), null, delegate { if (StopService()) ExitThread(); });
        icon.DoubleClick += delegate { Process.Start(MyBI.Url); };
        timer.Interval = 3000;
        timer.Tick += delegate { RefreshStatus(); };
        timer.Start();
        StartService();
    }

    void StartService()
    {
        if (launcher != null && !launcher.HasExited) return;
        if (launcher != null) launcher.Dispose();
        status.Text = MyBI.T("启动中…");
        icon.Text = "MyBI - " + status.Text;
        try
        {
            launcher = Process.Start(new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(MyBI.Root, "scripts", "start-workbench.ps1") + "\" -NoBrowser",
                WorkingDirectory = MyBI.Root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            });
        }
        catch (Exception error) { ShowError(error.Message); }
    }

    int ReadServerPid()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(MyBI.Url + "/api/health");
            request.Proxy = null;
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                var health = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                object state, root, pid;
                int value;
                if (health != null && health.TryGetValue("status", out state) && health.TryGetValue("project_root", out root) && health.TryGetValue("pid", out pid)
                    && Convert.ToString(state) == "ok" && string.Equals(Convert.ToString(root), MyBI.Root, StringComparison.OrdinalIgnoreCase)
                    && int.TryParse(Convert.ToString(pid), out value) && value > 0) return value;
            }
        }
        catch (WebException) { }
        catch (ArgumentException) { }
        return 0;
    }

    void RefreshStatus()
    {
        serverPid = ReadServerPid();
        stop.Enabled = serverPid != 0;
        if (launcher != null && launcher.HasExited)
        {
            if (launcher.ExitCode != 0) ShowError(launcher.StandardError.ReadToEnd() + launcher.StandardOutput.ReadToEnd());
            else if (serverPid != 0) Process.Start(MyBI.Url);
            launcher.Dispose(); launcher = null;
        }
        status.Text = MyBI.T(serverPid != 0 ? "运行中" : launcher != null ? "启动中…" : "已停止");
        icon.Text = "MyBI - " + status.Text;
    }

    bool StopService()
    {
        if (launcher != null && !launcher.HasExited) return false;
        try
        {
            serverPid = ReadServerPid();
            if (serverPid != 0)
            {
                using (var server = Process.GetProcessById(serverPid))
                {
                    if (server.ProcessName != "python" || ReadServerPid() != server.Id) throw new InvalidOperationException(MyBI.T("服务进程不匹配"));
                    server.Kill();
                }
            }
            RefreshStatus();
            return true;
        }
        catch (Exception error) { ShowError(error.Message); return false; }
    }

    void ShowError(string message) { MessageBox.Show(message, "MyBI", MessageBoxButtons.OK, MessageBoxIcon.Error); }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose(); icon.Visible = false; icon.Dispose(); appIcon.Dispose(); menu.Dispose();
            if (launcher != null) launcher.Dispose();
        }
        base.Dispose(disposing);
    }
}
