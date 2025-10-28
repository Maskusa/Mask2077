import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as os from 'os';

type Totals = { input: number; cached: number; output: number; };
type EventRow = { ts: number; model?: string; input: number; cached: number; output: number; file: string; };

class TokenAggregator {
  totals: Totals = { input: 0, cached: 0, output: 0 };
  byDay: Map<string, Totals> = new Map();
  byModel: Map<string, Totals> = new Map();
  events: EventRow[] = [];
  private onChangedEmitter = new vscode.EventEmitter<void>();
  readonly onChanged = this.onChangedEmitter.event;

  reset() {
    this.totals = { input: 0, cached: 0, output: 0 };
    this.byDay.clear();
    this.byModel.clear();
    this.events = [];
    this.onChangedEmitter.fire();
  }

  addEvent(ev: EventRow) {
    this.events.push(ev);
    this.totals.input += ev.input;
    this.totals.cached += ev.cached;
    this.totals.output += ev.output;

    const day = new Date(ev.ts).toISOString().slice(0,10);
    const d = this.byDay.get(day) ?? { input: 0, cached: 0, output: 0 };
    d.input += ev.input; d.cached += ev.cached; d.output += ev.output;
    this.byDay.set(day, d);

    const model = ev.model ?? 'unknown';
    const m = this.byModel.get(model) ?? { input: 0, cached: 0, output: 0 };
    m.input += ev.input; m.cached += ev.cached; m.output += ev.output;
    this.byModel.set(model, m);

    this.onChangedEmitter.fire();
  }

  toCSV(): string {
    const rows = ['timestamp,model,input_tokens,cached_tokens,output_tokens,file'];
    for (const ev of this.events) {
      rows.push([
        new Date(ev.ts).toISOString(),
        JSON.stringify(ev.model ?? ''),
        ev.input, ev.cached, ev.output,
        JSON.stringify(ev.file)
      ].join(','));
    }
    return rows.join('\n');
  }
}

class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codexTokenBoard.dashboardView';
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext, private readonly aggregator: TokenAggregator) {}

  resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    const update = () => this.postUpdate();
    this.aggregator.onChanged(update);
    update();
    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'openFile' && typeof msg.file === 'string') {
        const fileUri = vscode.Uri.file(msg.file);
        vscode.workspace.openTextDocument(fileUri).then(doc => vscode.window.showTextDocument(doc));
      }
    });
  }

  private postUpdate() {
    if (!this._view) { return; }
    const toObj = (m: Map<string, Totals>) => Array.from(m.entries()).map(([k,v]) => ({ key: k, ...v }));
    this._view.webview.postMessage({
      type: 'update',
      totals: this.aggregator.totals,
      byDay: toObj(this.aggregator.byDay),
      byModel: toObj(this.aggregator.byModel),
      recent: this.aggregator.events.slice(-50).reverse()
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = String(Math.random());
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.css'));
    return /* html */ `
      <!doctype html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${cssUri}" rel="stylesheet" />
        <title>Token Board</title>
      </head>
      <body>
        <div class="grid">
          <div class="card">
            <div class="label">INPUT</div>
            <div class="value" id="inputValue">0</div>
          </div>
          <div class="card">
            <div class="label">CACHED</div>
            <div class="value" id="cachedValue">0</div>
          </div>
          <div class="card">
            <div class="label">OUTPUT</div>
            <div class="value" id="outputValue">0</div>
          </div>
        </div>
        <div class="section">
          <h3>По дням</h3>
          <table id="byDayTable"><thead><tr><th>День</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead><tbody></tbody></table>
        </div>
        <div class="section">
          <h3>По моделям</h3>
          <table id="byModelTable"><thead><tr><th>Модель</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead><tbody></tbody></table>
        </div>
        <div class="section">
          <h3>Последние события</h3>
          <table id="recentTable"><thead><tr><th>Время</th><th>Модель</th><th>Input</th><th>Cached</th><th>Output</th><th>Файл</th></tr></thead><tbody></tbody></table>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}

function isProbablyJSONLine(line: string): boolean {
  const i = line.indexOf('{');
  const j = line.lastIndexOf('}');
  return i >= 0 && j > i;
}

function looksLikeUsage(candidate: any): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  const tokenKeys = [
    'input_tokens',
    'prompt_tokens',
    'total_tokens',
    'output_tokens',
    'completion_tokens',
    'cached_tokens',
    'cached_input_tokens'
  ];
  let hits = 0;
  for (const key of tokenKeys) {
    if (candidate[key] !== undefined) {
      hits++;
    }
  }
  if (hits >= 2) {
    return true;
  }
  if (candidate?.input_tokens_details?.cached_tokens !== undefined) {
    return true;
  }
  if (candidate?.prompt_tokens_details?.cached_tokens !== undefined) {
    return true;
  }
  return false;
}

function findUsage(obj: any): any | undefined {
  // Breadth-first search for usage-like objects inside the event
  const queue: any[] = [obj];
  const seen = new Set<any>();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) {
      continue;
    }
    seen.add(cur);

    if (looksLikeUsage(cur)) {
      return cur;
    }

    const directCandidates = [
      cur.usage,
      cur.total_token_usage,
      cur.token_usage,
      cur.last_token_usage,
      cur.usage_metadata,
      cur.usageStats
    ];
    for (const candidate of directCandidates) {
      if (candidate && typeof candidate === 'object' && looksLikeUsage(candidate)) {
        return candidate;
      }
    }

    for (const key of Object.keys(cur)) {
      const value = cur[key];
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return undefined;
}

function extractModel(obj: any): string | undefined {
  if (typeof obj?.model === 'string') return obj.model;
  if (typeof obj?.response?.model === 'string') return obj.response.model;
  return undefined;
}

function extractTimestamp(obj: any): number | undefined {
  // Accept unix seconds/millis or ISO strings in common keys
  const keys = ['created', 'timestamp', 'time', 'ts', 'date', 'datetime'];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number') {
      // Heuristic: if > 10^12 -> ms, else s
      return v > 1e12 ? v : v * 1000;
    }
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  return undefined;
}

function toInt(n: any): number {
  const x = typeof n === 'number' ? n : parseInt(String(n), 10);
  return Number.isFinite(x) ? x : 0;
}

function normalizeUsage(usage: any): { input: number; cached: number; output: number } {
  const input = toInt(
    usage?.input_tokens ??
    usage?.prompt_tokens ??
    usage?.total_tokens ??
    usage?.tokens_in ??
    usage?.total_prompt_tokens ??
    0
  );
  const output = toInt(
    usage?.output_tokens ??
    usage?.completion_tokens ??
    usage?.tokens_out ??
    0
  );
  const cached = toInt(
    usage?.input_tokens_details?.cached_tokens ??
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.cached_tokens ??
    usage?.cached_input_tokens ??
    usage?.tokens_cached ??
    0
  );
  return { input, cached, output };
}

async function readExistingFile(fileUri: vscode.Uri, aggregator: TokenAggregator) {
  try {
    const stream = fs.createReadStream(fileUri.fsPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      await parseLine(line, fileUri, aggregator);
    }
  } catch (e) {
    console.error('readExistingFile error', e);
  }
}

async function parseLine(line: string, fileUri: vscode.Uri, aggregator: TokenAggregator) {
  if (!line || line.length < 2) return;
  if (!isProbablyJSONLine(line)) return;
  try {
    const obj = JSON.parse(line);
    const usage = findUsage(obj);
    if (!usage) return;
    const { input, cached, output } = normalizeUsage(usage);
    if (input === 0 && output === 0 && cached === 0) return;
    const ts = extractTimestamp(obj) ?? Date.now();
    const model = extractModel(obj);
    aggregator.addEvent({ ts, model, input, cached, output, file: fileUri.fsPath });
  } catch {
    // ignore non-JSON lines
  }
}

class LogWatcher {
  private timer?: NodeJS.Timeout;
  private fileOffsets: Map<string, number> = new Map();
  private knownFiles: Set<string> = new Set();
  private remainder: Map<string, string> = new Map();

  constructor(
    private readonly folder: vscode.Uri,
    private readonly glob: string,
    private readonly intervalMs: number,
    private readonly aggregator: TokenAggregator,
    private readonly parseHistoryOnStart: boolean
  ) {}

  async start() {
    // initial scan
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder, this.glob));
    for (const f of files) {
      this.knownFiles.add(f.fsPath);
      const stat = await vscode.workspace.fs.stat(f);
      const size = stat.size ?? 0;
      if (this.parseHistoryOnStart) {
        await readExistingFile(f, this.aggregator);
        this.fileOffsets.set(f.fsPath, size);
      } else {
        this.fileOffsets.set(f.fsPath, size);
      }
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder, this.glob));
      // handle new files
      for (const f of files) {
        if (!this.knownFiles.has(f.fsPath)) {
          this.knownFiles.add(f.fsPath);
          const stat = await vscode.workspace.fs.stat(f);
          const size = stat.size ?? 0;
          // read entire new file once
          await readExistingFile(f, this.aggregator);
          this.fileOffsets.set(f.fsPath, size);
        }
      }
      // read appends
      for (const filePath of Array.from(this.knownFiles)) {
        try {
          const furi = vscode.Uri.file(filePath);
          const stat = await vscode.workspace.fs.stat(furi);
          const newSize = stat.size ?? 0;
          const prev = this.fileOffsets.get(filePath) ?? 0;
          if (newSize < prev) {
            // file rotated or truncated
            this.fileOffsets.set(filePath, 0);
          }
          if (newSize > prev) {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8', start: prev, end: newSize - 1 });
            const chunks: string[] = [];
            await new Promise<void>((resolve, reject) => {
              stream.on('data', d => chunks.push(String(d)));
              stream.on('error', reject);
              stream.on('end', resolve);
            });
            const oldRemainder = this.remainder.get(filePath) ?? '';
            const data = oldRemainder + chunks.join('');
            const lines = data.split(/\r?\n/);
            this.remainder.set(filePath, lines.pop() ?? '');
            for (const line of lines) {
              await parseLine(line, furi, this.aggregator);
            }
            this.fileOffsets.set(filePath, newSize);
          }
        } catch (e) {
          // file might have been deleted/moved
        }
      }
    } catch (e) {
      console.error('tick error', e);
    }
  }
}

let aggregator: TokenAggregator;
let watcher: LogWatcher | undefined;
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  aggregator = new TokenAggregator();
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = 'Tokens: —';
  statusBar.command = 'codexTokenBoard.openDashboard';
  statusBar.show();
  const updateStatus = () => {
    statusBar.text = `Tokens ⟶ IN:${aggregator.totals.input} | CA:${aggregator.totals.cached} | OUT:${aggregator.totals.output}`;
  };
  aggregator.onChanged(updateStatus);

  const provider = new DashboardViewProvider(context, aggregator);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider));

  context.subscriptions.push(vscode.commands.registerCommand('codexTokenBoard.openDashboard', () => {
    vscode.commands.executeCommand('workbench.view.explorer');
    // The view appears in the Explorer pane; posting a no-op to ensure render
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codexTokenBoard.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codex-token-board');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codexTokenBoard.resetStats', () => {
    aggregator.reset();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codexTokenBoard.exportCSV', async () => {
    const csv = aggregator.toCSV();
    const uri = await vscode.window.showSaveDialog({ filters: { 'CSV': ['csv'] }, saveLabel: 'Save token events CSV' });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));
      vscode.window.showInformationMessage('Token events CSV saved.');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codexTokenBoard.selectLogFolder', async () => {
    const pick = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Select log folder'
    } as any);
    if (pick && pick[0]) {
      await vscode.workspace.getConfiguration().update('codexTokenBoard.logFolder', pick[0].fsPath, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Log folder set to: ${pick[0].fsPath}`);
      await restartWatcher(context, { resetAggregator: true, forceParseHistory: true });
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codexTokenBoard.rebuildIndex', async () => {
    await restartWatcher(context, { resetAggregator: true, forceParseHistory: true });
    vscode.window.showInformationMessage('Token Board: logs re-scanned.');
  }));

  await restartWatcher(context, { resetAggregator: true });
}

type RestartOptions = {
  forceParseHistory?: boolean;
  resetAggregator?: boolean;
};

async function restartWatcher(context: vscode.ExtensionContext, options: RestartOptions = {}) {
  if (watcher) { watcher.dispose(); watcher = undefined; }
  if (options.resetAggregator) {
    aggregator.reset();
  }
  const cfg = vscode.workspace.getConfiguration();
  let folder = cfg.get<string>('codexTokenBoard.logFolder') || '';
  if (!folder || !fs.existsSync(folder)) {
    const auto = await detectLogFolder();
    if (auto) {
      folder = auto;
      await cfg.update('codexTokenBoard.logFolder', auto, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Token Board: log folder auto-set to ${auto}`);
    }
  }
  const glob = cfg.get<string>('codexTokenBoard.fileGlob') || '**/*.{jsonl,log,jlog,json}';
  const interval = cfg.get<number>('codexTokenBoard.pollIntervalMs') || 1000;
  const parseHistory = options.forceParseHistory ? true : (cfg.get<boolean>('codexTokenBoard.parseHistoryOnStart') ?? true);

  if (!folder || !fs.existsSync(folder)) {
    vscode.window.showWarningMessage('Token Board: log folder is not set. Use Token Board: Select Log Folder.');
    return;
  }
  const folderUri = vscode.Uri.file(folder);
  watcher = new LogWatcher(folderUri, glob, interval, aggregator, parseHistory);
  await watcher.start();
}

async function detectLogFolder(): Promise<string | undefined> {
  const envCandidates = ['CODEX_LOG_DIR', 'CODEX_LOG_FOLDER', 'CODEX_SESSION_LOGS']
    .map(key => process.env[key])
    .filter((value): value is string => !!value && value.trim().length > 0);

  const home = os.homedir();
  const defaultCandidates = [
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'logs'),
    path.join(home, '.codex')
  ];

  const candidates = [...envCandidates, ...defaultCandidates];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.lstatSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // ignore filesystem errors and continue
    }
  }
  return undefined;
}

export function deactivate() {
  watcher?.dispose();
}
