import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Share } from '@capacitor/share';
import {
  Filesystem,
  Directory,
  Encoding as FilesystemEncoding,
} from '@capacitor/filesystem';
import Button from './Button';
import { PROXY_CONFIG } from '../constants/proxy';
import {
  NativeVpn,
  type VpnDiagnosticEntry,
  type VpnDiagnosticRequest,
  type VpnDiagnosticType,
  type VpnState,
} from '../native/nativeVpn';

type RefreshReason = 'manual' | 'ping' | 'auto';

interface ServerSettingsProps {
  onBack: () => void;
  onShowLogs: () => void;
  addLog: (message: string) => void;
}

interface ProxyFormState {
  host: string;
  apiBase: string;
  apiToken: string;
}

interface ProxyRuntimeState {
  enabled: boolean;
  host: string;
  port: number;
  latencyMs: number | null;
  lastUpdated: number | null;
  lastError: string | null;
  connectedAt: number | null;
  apiBase: string;
  apiToken: string;
}

interface ServerMetrics {
  proxyStatus: Record<string, unknown> | unknown[] | null;
  wireguardStatus: Record<string, unknown> | unknown[] | null;
  systemInfo: Record<string, unknown> | unknown[] | null;
  updatedAt: number | null;
}

interface TrafficMetrics {
  sentBytes: number | null;
  receivedBytes: number | null;
  upSpeed: number | null;
  downSpeed: number | null;
}

interface ApiCallResult<T = unknown> {
  data: T | null;
  apiBase: string;
  tokenUsed: string;
}

interface CallServerApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown> | null;
  description?: string;
}

interface WireGuardEndpointInfo {
  host: string;
  port: number;
}

interface WireGuardPreflightResult {
  configText: string;
  endpointInfo: WireGuardEndpointInfo;
  serverListenPort: number | null;
  profileMeta: {
    deviceId: string;
    reused: boolean;
    ip?: string | null;
    name?: string | null;
    publicKey?: string | null;
  };
}

interface ProfileCardField {
  label: string;
  value: string;
  monospace?: boolean;
}

interface ProfileCardData {
  title: string;
  fields: ProfileCardField[];
}

const DEVICE_ID_STORAGE_KEY = 'vpn_device_id';
const STATUS_REFRESH_INTERVAL = 45_000;
const PROXY_ENV_BYPASS = 'localhost,127.0.0.1';
const DEFAULT_WIREGUARD_DNS = '1.1.1.1, 8.8.8.8';
const DEFAULT_WIREGUARD_MTU = '1280';
const DEFAULT_WIREGUARD_KEEPALIVE = '25';
const DEFAULT_WIREGUARD_ALLOWED_IPS = '0.0.0.0/0';
const DEFAULT_API_TCP_PORT = 8787;
const API_VERBOSE_PREVIEW_LIMIT = 4000;
const MAX_VPN_LOG_ENTRIES = 500;
const FULL_TEST_TYPES = ['ping', 'dns', 'tcp', 'http', 'https', 'api_tls'] as const;
type FullTestType = (typeof FULL_TEST_TYPES)[number];
const ENDPOINT_PORT_PROBES = [443];
const DNS_PROBE_HOSTS = [
  '45-151-183-153.sslip.io',
  'api.ipify.org',
  'ipv4.icanhazip.com',
  'ifconfig.me',
];
type ProbePhase = 'pre' | 'post';
const PROBE_PHASES: ProbePhase[] = ['pre', 'post'];

interface DiagResult {
  status: 'idle' | 'pending' | 'success' | 'error';
  latencyMs?: number | null;
  message?: string | null;
}

interface PortProbeRow {
  port: number;
  protocol: 'tcp' | 'udp';
  success: boolean;
  latencyMs: number | null;
  message: string | null;
}

interface DnsProbeRow {
  host: string;
  success: boolean;
  latencyMs: number | null;
  message: string | null;
}

interface ProbeSummary<Row> {
  host: string;
  phase: ProbePhase;
  timestamp: number;
  rows: Row[];
}

const buildInitialDiagResults = (): Record<FullTestType, DiagResult> =>
  FULL_TEST_TYPES.reduce(
    (acc, testId) => {
      acc[testId] = { status: 'idle' };
      return acc;
    },
    {} as Record<FullTestType, DiagResult>
  );

const isFullTestType = (value: string): value is FullTestType =>
  FULL_TEST_TYPES.includes(value as FullTestType);

const getDiagStatusMeta = (status: DiagResult['status']) => {
  switch (status) {
    case 'success':
      return {
        label: 'Успешно',
        container: 'bg-emerald-500/10 border-emerald-400/50 text-emerald-100',
        pill: 'bg-emerald-500/20 text-emerald-100',
      };
    case 'error':
      return {
        label: 'Ошибка',
        container: 'bg-rose-500/10 border-rose-400/50 text-rose-100',
        pill: 'bg-rose-500/20 text-rose-100',
      };
    case 'pending':
      return {
        label: 'В процессе',
        container: 'bg-amber-500/10 border-amber-400/50 text-amber-100',
        pill: 'bg-amber-500/20 text-amber-900',
      };
    default:
      return {
        label: 'Не запускался',
        container: 'bg-slate-800/70 border-slate-700/70 text-slate-200',
        pill: 'bg-slate-700/70 text-slate-200',
      };
  }
};

const CONNECTION_CHECKLIST_STEPS = [
  {
    id: 'serverHealth',
    label: 'Проверка сервера',
    description: 'API /oneclick + /wg/status',
  },
  {
    id: 'endpointReachable',
    label: 'Пинг сервера',
    description: 'Ping/TCP до Endpoint',
  },
  {
    id: 'profileReady',
    label: 'WireGuard профиль',
    description: 'Конфиг нормализован',
  },
  {
    id: 'routingReady',
    label: 'Маршрутизация',
    description: 'proxy/status + wg/status на связи',
  },
  {
    id: 'handshake',
    label: 'Рукопожатие',
    description: 'wg show обновляет latest handshake',
  },
  {
    id: 'tunnelUp',
    label: 'Туннель',
    description: 'NativeVpn сообщает running',
  },
  {
    id: 'dnsReady',
    label: 'DNS',
    description: 'Разрешение ключевых доменов',
  },
  {
    id: 'ipUpdated',
    label: 'Новый IP',
    description: 'ipify / api.myip.com',
  },
] as const;

type ConnectionChecklistStepId = (typeof CONNECTION_CHECKLIST_STEPS)[number]['id'];
type ChecklistStatus = 'idle' | 'pending' | 'in_progress' | 'success' | 'error';

interface ChecklistEntry {
  status: ChecklistStatus;
  detail: string | null;
  updatedAt: number | null;
}

type ConnectionChecklistState = Record<ConnectionChecklistStepId, ChecklistEntry>;

const HANDSHAKE_FRESH_THRESHOLD_SEC = 120;

const buildInitialChecklistState = (
  status: ChecklistStatus = 'idle'
): ConnectionChecklistState =>
  CONNECTION_CHECKLIST_STEPS.reduce((acc, step) => {
    acc[step.id] = { status, detail: null, updatedAt: null };
    return acc;
  }, {} as ConnectionChecklistState);

const getChecklistStatusMeta = (status: ChecklistStatus) => {
  switch (status) {
    case 'success':
      return {
        label: 'Готово',
        pill: 'bg-emerald-500/20 text-emerald-100',
        container: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100',
      };
    case 'error':
      return {
        label: 'Ошибка',
        pill: 'bg-rose-500/20 text-rose-100',
        container: 'border-rose-500/30 bg-rose-500/5 text-rose-100',
      };
    case 'in_progress':
      return {
        label: 'Выполняется',
        pill: 'bg-sky-500/20 text-sky-100',
        container: 'border-sky-500/30 bg-sky-500/5 text-sky-100',
      };
    case 'pending':
      return {
        label: 'Ожидает',
        pill: 'bg-amber-500/20 text-amber-900',
        container: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
      };
    default:
      return {
        label: 'Не запускалось',
        pill: 'bg-slate-700/60 text-slate-200',
        container: 'border-slate-700/70 bg-slate-900/70 text-slate-300',
      };
  }
};

const extractHandshakeAgeSeconds = (source: unknown): number | null => {
  const summary =
    typeof source === 'string'
      ? source
      : source && typeof source === 'object' && 'summary' in (source as Record<string, unknown>)
      ? String((source as { summary?: unknown }).summary ?? '')
      : '';
  if (!summary) {
    return null;
  }
  const match = summary.match(/latest handshake:\s*([^\n]+)/i);
  if (!match) {
    return null;
  }
  const raw = match[1].trim().toLowerCase();
  if (!raw || raw.includes('none') || raw.includes('never')) {
    return null;
  }
  if (raw === 'now') {
    return 0;
  }
  const unitRegex = /(\d+)\s+(second|minute|hour|day)s?/g;
  let totalSeconds = 0;
  let matched = false;
  let unitMatch: RegExpExecArray | null;
  while ((unitMatch = unitRegex.exec(raw)) !== null) {
    matched = true;
    const value = Number.parseInt(unitMatch[1], 10);
    const unit = unitMatch[2];
    const multiplier =
      unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400;
    totalSeconds += value * multiplier;
  }
  if (!matched) {
    const numeric = Number.parseInt(raw.replace(/\D+/g, ''), 10);
    return Number.isNaN(numeric) ? null : numeric;
  }
  return totalSeconds;
};

interface ExternalIpSource {
  id: string;
  label: string;
  url: string;
  type: 'json' | 'text';
  field?: string;
}

const EXTERNAL_IP_SOURCES: ExternalIpSource[] = [
  {
    id: 'ipify',
    label: 'api.ipify.org',
    url: 'https://api.ipify.org?format=json',
    type: 'json',
    field: 'ip',
  },
  {
    id: 'myip',
    label: 'api.myip.com',
    url: 'https://api.myip.com',
    type: 'json',
    field: 'ip',
  },
  {
    id: 'ifconfig',
    label: 'ifconfig.me',
    url: 'https://ifconfig.me/ip',
    type: 'text',
  },
  {
    id: 'icanhazip',
    label: 'icanhazip.com',
    url: 'https://ipv4.icanhazip.com',
    type: 'text',
  },
];

const IP_DISCOVERY_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildIpDiscoveryQueue = (): ExternalIpSource[] => {
  const queue: ExternalIpSource[] = [...EXTERNAL_IP_SOURCES];
  const seen = new Set<string>(queue.map((item) => item.id));
  for (const source of EXTERNAL_IP_SOURCES) {
    try {
      const parsed = new URL(source.url);
      if (parsed.protocol === 'https:') {
        parsed.protocol = 'http:';
        const variant: ExternalIpSource = {
          ...source,
          id: `${source.id}-http`,
          label: `${source.label} (http)`,
          url: parsed.toString(),
        };
        if (!seen.has(variant.id)) {
          queue.push(variant);
          seen.add(variant.id);
        }
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return queue;
};

const IP_DISCOVERY_PROBES = buildIpDiscoveryQueue();

const formatLatency = (value: number | null): string =>
  value == null || value < 0 ? 'n/a' : `${value} ms`;

const formatTimestamp = (value: number | null): string =>
  !value ? 'n/a' : new Date(value).toLocaleString();

const formatBytes = (value: number | null): string => {
  if (value == null || value < 0) {
    return 'n/a';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const digits = size >= 100 || idx === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[idx]}`;
};

const formatSpeed = (value: number | null): string =>
  value == null || value < 0 ? 'n/a' : `${formatBytes(value)}/s`;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return value ? String(value) : 'n/a';
  }
};

const buildPayloadPreview = (value: unknown): string => {
  const serialized = safeStringify(value);
  if (serialized.length <= API_VERBOSE_PREVIEW_LIMIT) {
    return serialized;
  }
  const trimmed = serialized.slice(0, API_VERBOSE_PREVIEW_LIMIT);
  const remaining = serialized.length - API_VERBOSE_PREVIEW_LIMIT;
  return `${trimmed} ... (+${remaining} chars)`;
};

const parseNumericValue = (input: unknown): number | null => {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const normalized = input.trim().replace(',', '.');
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const numeric = Number(match[0]);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const lower = normalized.toLowerCase();
    if (lower.includes('gbps') || lower.includes('gb/s')) {
      return numeric * 1024 * 1024 * 1024;
    }
    if (lower.includes('mbps') || lower.includes('mb/s')) {
      return numeric * 1024 * 1024;
    }
    if (lower.includes('kbps') || lower.includes('kb/s')) {
      return numeric * 1024;
    }
    if (lower.includes('gb')) {
      return numeric * 1024 * 1024 * 1024;
    }
    if (lower.includes('mb')) {
      return numeric * 1024 * 1024;
    }
    if (lower.includes('kb')) {
      return numeric * 1024;
    }
    return numeric;
  }
  return null;
};

const extractMetric = (source: unknown, keys: readonly string[]): number | null => {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const lookup = new Set(keys.map((key) => key.toLowerCase()));
  const queue: unknown[] = [source];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [rawKey, rawValue] of Object.entries(
      current as Record<string, unknown>
    )) {
      if (lookup.has(rawKey.toLowerCase())) {
        const numeric = parseNumericValue(rawValue);
        if (numeric !== null) {
          return numeric;
        }
      }
      if (rawValue && typeof rawValue === 'object') {
        queue.push(rawValue);
      }
    }
  }
  return null;
};

const deriveTrafficMetrics = (source: unknown): TrafficMetrics => {
  if (!source || typeof source !== 'object') {
    return {
      sentBytes: null,
      receivedBytes: null,
      upSpeed: null,
      downSpeed: null,
    };
  }
  const payload = source as Record<string, unknown>;
  const sentBytes = extractMetric(payload, ['txbytes', 'sentbytes']);
  const receivedBytes = extractMetric(payload, ['rxbytes', 'receivedbytes']);
  const upSpeed = extractMetric(payload, ['uploadspeed', 'upspeed']);
  const downSpeed = extractMetric(payload, ['downloadspeed', 'downspeed']);
  return { sentBytes, receivedBytes, upSpeed, downSpeed };
};

const normalizeWireGuardConfig = (rawText: string): string => {
  let result = rawText.replace(/\r\n/g, '\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  const ensureDirective = (
    section: 'Interface' | 'Peer',
    directive: string,
    value: string,
    options: { forceValue?: boolean } = {}
  ) => {
    const { forceValue = false } = options;
    const sectionRegex = new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i');
    const match = result.match(sectionRegex);
    if (!match) {
      return;
    }
    const block = match[0];
    const directiveRegex = new RegExp(
      `(^|\\n)(\\s*${directive}\\s*=\\s*)(.+)$`,
      'mi'
    );
    let replacement = block;
    if (directiveRegex.test(block)) {
      if (!forceValue) {
        return;
      }
      replacement = block.replace(
        directiveRegex,
        (_unused, prefix: string, key: string) => `${prefix}${key}${value}`
      );
    } else {
      const suffix = block.endsWith('\n') ? '' : '\n';
      replacement = `${block}${suffix}${directive} = ${value}\n`;
    }
    if (replacement !== block) {
      result = result.replace(block, replacement);
    }
  };

  ensureDirective('Interface', 'DNS', DEFAULT_WIREGUARD_DNS, { forceValue: true });
  ensureDirective('Interface', 'MTU', DEFAULT_WIREGUARD_MTU, { forceValue: true });
  ensureDirective('Peer', 'PersistentKeepalive', DEFAULT_WIREGUARD_KEEPALIVE, {
    forceValue: true,
  });
  ensureDirective('Peer', 'AllowedIPs', DEFAULT_WIREGUARD_ALLOWED_IPS, {
    forceValue: true,
  });
  return result.trim();
};

const sanitizeWireGuardConfig = (text: string): string => {
  const mask = (input: string, label: string) =>
    input.replace(
      new RegExp(`(^|\\n)(\\s*${label}\\s*=\\s*)(.+)$`, 'gim'),
      (_unused, prefix, key) => `${prefix}${key}***`
    );
  let sanitized = mask(text, 'PrivateKey');
  sanitized = mask(sanitized, 'PresharedKey');
  return sanitized.trim();
};

const extractEndpointInfo = (configText: string): WireGuardEndpointInfo | null => {
  const match = configText.match(/Endpoint\s*=\s*([^\s:]+):(\d+)/i);
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    port: Number.parseInt(match[2], 10) || 0,
  };
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readConfigValue = (configText: string, directive: string): string | null => {
  if (!configText || !directive) {
    return null;
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(directive)}\\s*=\\s*(.+)$`, 'mi');
  const match = pattern.exec(configText);
  return match ? match[1].trim() : null;
};

interface PeerSummaryDetails {
  endpoint?: string | null;
  allowedIps?: string | null;
  latestHandshake?: string | null;
  transferReceived?: string | null;
  transferSent?: string | null;
  transferRaw?: string | null;
}

const extractPeerSummaryDetails = (
  source: unknown,
  peerPublicKey?: string | null
): PeerSummaryDetails | null => {
  if (!peerPublicKey) {
    return null;
  }
  const summary =
    typeof source === 'string'
      ? source
      : source && typeof source === 'object' && 'summary' in (source as Record<string, unknown>)
      ? String((source as { summary?: unknown }).summary ?? '')
      : '';
  if (!summary) {
    return null;
  }
  const target = peerPublicKey.trim();
  if (!target) {
    return null;
  }
  const lines = summary.split('\n');
  let capture = false;
  const details: PeerSummaryDetails = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.toLowerCase().startsWith('peer:')) {
      const value = line.slice(line.indexOf(':') + 1).trim();
      if (capture && value !== target) {
        break;
      }
      capture = value === target;
      continue;
    }
    if (!capture) {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!value) {
      continue;
    }
    switch (key) {
      case 'endpoint':
        details.endpoint = value;
        break;
      case 'allowed ips':
        details.allowedIps = value;
        break;
      case 'latest handshake':
        details.latestHandshake = value;
        break;
      case 'transfer': {
        details.transferRaw = value;
        const match = value.match(/([\d.,]+\s*\w+)\s+received,\s+([\d.,]+\s*\w+)\s+sent/i);
        if (match) {
          details.transferReceived = match[1].trim();
          details.transferSent = match[2].trim();
        }
        break;
      }
      default:
        break;
    }
  }
  return Object.keys(details).length > 0 ? details : null;
};

const overrideWireGuardEndpoint = (
  configText: string,
  endpoint: WireGuardEndpointInfo
): string => {
  const regex = /(Endpoint\s*=\s*)([^\s:]+):(\d+)/i;
  if (!regex.test(configText)) {
    return configText;
  }
  return configText.replace(
    regex,
    (_match, prefix: string) => `${prefix}${endpoint.host}:${endpoint.port}`
  );
};

const extractListenPortFromSummary = (payload: unknown): number | null => {
  if (typeof payload === 'string') {
    const match = payload.match(/listening port:\s*(\d+)/i);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
    return null;
  }
  if (
    payload &&
    typeof payload === 'object' &&
    'summary' in (payload as Record<string, unknown>)
  ) {
    return extractListenPortFromSummary(
      (payload as { summary?: unknown }).summary ?? null
    );
  }
  return null;
};

const parseExternalIp = (
  source: ExternalIpSource,
  payload: unknown
): string | null => {
  if (source.type === 'json') {
    let jsonPayload: Record<string, unknown> | null = null;
    if (typeof payload === 'string') {
      try {
        jsonPayload = JSON.parse(payload);
      } catch {
        return null;
      }
    } else if (payload && typeof payload === 'object') {
      jsonPayload = payload as Record<string, unknown>;
    }
    if (!jsonPayload) {
      return null;
    }
    const candidate = source.field ? jsonPayload[source.field] : jsonPayload['ip'];
    if (typeof candidate === 'string') {
      return candidate.trim();
    }
    if (candidate != null) {
      return String(candidate).trim();
    }
    return null;
  }
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (payload != null) {
    return String(payload).trim();
  }
  return null;
};

const normalizeApiBase = (rawBase: string, host: string) => {
  if (!rawBase || rawBase.trim().length === 0) {
    return `https://${host}:8787`;
  }
  try {
    const url = new URL(rawBase);
    if (!url.host) {
      url.hostname = host;
    }
    if (!url.port) {
      url.port = '8787';
    }
    url.protocol = 'https:';
    return url.toString().replace(/\/$/, '');
  } catch {
    return `https://${host}:8787`;
  }
};

const encodeUtf8Base64 = (value: string): string => {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
};

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const loadStoredDeviceId = (): string | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
};

const persistDeviceId = (value: string) => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(DEVICE_ID_STORAGE_KEY, value);
  } catch {
    // ignore storage errors
  }
};

const buildEnvironmentReport = (
  runtime: ProxyRuntimeState,
  form: ProxyFormState,
  metrics: ServerMetrics,
  vpnRunning: boolean
) => {
  const host = runtime.host || form.host || PROXY_CONFIG.host;
  const lines = [
    `Host   : ${host}:${runtime.port}`,
    `Mode   : WireGuard`,
    `VPN    : ${vpnRunning ? 'running' : 'stopped'}`,
    `API    : ${runtime.apiBase}`,
    `Token  : ${runtime.apiToken.slice(0, 4)}***`,
    `Latency: ${formatLatency(runtime.latencyMs)}`,
    `Updated: ${formatTimestamp(runtime.lastUpdated)}`,
    `LastErr: ${runtime.lastError ?? 'none'}`,
    '',
    `Platform: ${Capacitor.getPlatform()}`,
    `NO_PROXY: ${PROXY_ENV_BYPASS}`,
  ];
  if (metrics.proxyStatus) {
    lines.push('', '/proxy/status', safeStringify(metrics.proxyStatus));
  }
  if (metrics.wireguardStatus) {
    lines.push('', '/wg/status', safeStringify(metrics.wireguardStatus));
  }
  if (metrics.systemInfo) {
    lines.push('', '/system/info', safeStringify(metrics.systemInfo));
  }
  return lines.filter(Boolean).join('\n');
};

const initialForm: ProxyFormState = {
  host: PROXY_CONFIG.host ?? '',
  apiBase: '',
  apiToken: PROXY_CONFIG.apiToken ?? '',
};

const ServerSettings: React.FC<ServerSettingsProps> = ({
  onBack,
  onShowLogs,
  addLog,
}) => {
  const [form, setForm] = useState<ProxyFormState>(initialForm);
  const [runtime, setRuntime] = useState<ProxyRuntimeState>({
    enabled: false,
    host: '',
    port: 0,
    latencyMs: null,
    lastUpdated: null,
    lastError: null,
    connectedAt: null,
    apiBase: '',
    apiToken: '',
  });
  const [traffic, setTraffic] = useState<TrafficMetrics>({
    sentBytes: null,
    receivedBytes: null,
    upSpeed: null,
    downSpeed: null,
  });
  const [serverMetrics, setServerMetrics] = useState<ServerMetrics>({
    proxyStatus: null,
    wireguardStatus: null,
    systemInfo: null,
    updatedAt: null,
  });
  const [vpnState, setVpnState] = useState<VpnState | null>(null);
  const [vpnError, setVpnError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [vpnLog, setVpnLog] = useState<string[]>([]);
  const [initialIp, setInitialIp] = useState<string | null>(null);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [ipSourceLabel, setIpSourceLabel] = useState<string | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);
  const [statusReport, setStatusReport] = useState('');
  const [diagProgress, setDiagProgress] = useState<string | null>(null);
  const [diagResults, setDiagResults] = useState<Record<FullTestType, DiagResult>>(
    () => buildInitialDiagResults()
  );
  const [diagProgressValue, setDiagProgressValue] = useState(0);
  const [lastDiagAt, setLastDiagAt] = useState<number | null>(null);
  const [portProbeResults, setPortProbeResults] = useState<Record<ProbePhase, ProbeSummary<PortProbeRow> | null>>({
    pre: null,
    post: null,
  });
  const [udpProbeResults, setUdpProbeResults] = useState<Record<ProbePhase, ProbeSummary<PortProbeRow> | null>>({
    pre: null,
    post: null,
  });
  const [dnsProbeResults, setDnsProbeResults] = useState<Record<ProbePhase, ProbeSummary<DnsProbeRow> | null>>({
    pre: null,
    post: null,
  });
  const [connectionChecklist, setConnectionChecklist] =
    useState<ConnectionChecklistState>(() => buildInitialChecklistState());
  const [probePortList, setProbePortList] = useState<number[]>(ENDPOINT_PORT_PROBES);
  const [testBlockInProgress, setTestBlockInProgress] = useState(false);
  const [testBlockStatus, setTestBlockStatus] = useState<string | null>(null);
  const [portFallbackEnabled, setPortFallbackEnabled] = useState(false);
  const [lastProfileResult, setLastProfileResult] = useState<WireGuardPreflightResult | null>(null);
  const displayedPortList = useMemo(
    () => (probePortList.length > 0 ? probePortList : ENDPOINT_PORT_PROBES),
    [probePortList]
  );

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const deviceIdRef = useRef<string | null>(loadStoredDeviceId());
  const isNativePlatform = Capacitor.getPlatform() !== 'web';
  const vpnPluginAvailable = Boolean(NativeVpn);

  const appendVpnLog = useCallback(
    (
      tag: string,
      message: string,
      extra?: Record<string, unknown> | null,
      highlight = false
    ) => {
      const entry = `[${new Date().toISOString()}] ${tag}: ${message}${
        extra ? ` ${safeStringify(extra)}` : ''
      }`;
      setVpnLog((previous) => {
        const next = highlight ? [...previous, '---', entry] : [...previous, entry];
        if (next.length > MAX_VPN_LOG_ENTRIES) {
          return next.slice(-MAX_VPN_LOG_ENTRIES);
        }
        return next;
      });
    },
    []
  );

  const resetConnectionChecklist = useCallback(
    (status: ChecklistStatus = 'idle') => {
      setConnectionChecklist(buildInitialChecklistState(status));
    },
    []
  );

  const updateChecklistStep = useCallback(
    (stepId: ConnectionChecklistStepId, status: ChecklistStatus, detail?: string | null) => {
      let changed = false;
      const normalizedDetail = detail ?? null;
      setConnectionChecklist((previous) => {
        const current = previous[stepId];
        const isSame =
          current &&
          current.status === status &&
          (current.detail ?? null) === normalizedDetail;
        if (isSame) {
          return previous;
        }
        changed = true;
        return {
          ...previous,
          [stepId]: {
            status,
            detail: normalizedDetail,
            updatedAt: Date.now(),
          },
        };
      });
      if (changed) {
        appendVpnLog(
          'CHECKLIST',
          `${stepId}:${status}`,
          normalizedDetail ? { detail: normalizedDetail } : undefined
        );
      }
    },
    [appendVpnLog]
  );

  const resetDiagResults = useCallback(
    (initialStatus: DiagResult['status'] = 'idle') => {
      setDiagResults(() => {
        const initial = buildInitialDiagResults();
        FULL_TEST_TYPES.forEach((id) => {
          initial[id] = { status: initialStatus };
        });
        return initial;
      });
      setDiagProgressValue(0);
    },
    []
  );

  const runSocketProbeMatrix = useCallback(
    async (
      host: string,
      phase: ProbePhase,
      ports: number[] | undefined,
      protocol: 'tcp' | 'udp',
      logTag: 'PORT_PROBE' | 'UDP_PROBE',
      setter: React.Dispatch<
        React.SetStateAction<Record<ProbePhase, ProbeSummary<PortProbeRow> | null>>
      >
    ) => {
      if (!host) {
        return [];
      }
      const availablePorts =
        ports && ports.length > 0
          ? ports
          : probePortList.length > 0
          ? probePortList
          : ENDPOINT_PORT_PROBES;
      appendVpnLog(logTag, `${phase}_start`, { host, ports: availablePorts, protocol });
      if (!vpnPluginAvailable || !NativeVpn?.diagnose) {
        const fallbackRows = availablePorts.map<PortProbeRow>((port) => ({
          port,
          protocol,
          success: false,
          latencyMs: null,
          message: 'Диагностика недоступна (NativeVpn)',
        }));
        setter((previous) => ({
          ...previous,
          [phase]: {
            host,
            phase,
            timestamp: Date.now(),
            rows: fallbackRows,
          },
        }));
        return fallbackRows;
      }
      const rows: PortProbeRow[] = [];
      for (const port of availablePorts) {
        try {
          const diagnostic = await NativeVpn.diagnose({
            host,
            port,
            tests: [protocol as VpnDiagnosticType],
            timeoutMs: 6000,
          });
          const entry = diagnostic.results.find(
            (result) => (result.type ?? '').toLowerCase() === protocol
          );
          let success = entry?.success ?? false;
          const latencyMs = entry?.latencyMs ?? null;
          let message = entry?.message ?? null;
          if (protocol === 'udp') {
            const unknown =
              typeof message === 'string' &&
              message.trim().length > 0 &&
              /unknown|unsupported/i.test(message);
            if (!entry || unknown) {
              success = false;
              message = 'UDP-пробы не поддерживаются NativeVpn (пропущено)';
            }
          }
          rows.push({ port, protocol, success, latencyMs, message });
          appendVpnLog(`${logTag}_RESULT`, phase, { port, protocol, success, latencyMs, message });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push({ port, protocol, success: false, latencyMs: null, message });
          appendVpnLog(`${logTag}_ERROR`, phase, { port, protocol, error: message });
        }
      }
      setter((previous) => ({
        ...previous,
        [phase]: {
          host,
          phase,
          timestamp: Date.now(),
          rows,
        },
      }));
      return rows;
    },
    [appendVpnLog, probePortList, vpnPluginAvailable]
  );

  const runPortProbeMatrix = useCallback(
    (host: string, phase: ProbePhase, ports?: number[]) =>
      runSocketProbeMatrix(host, phase, ports, 'tcp', 'PORT_PROBE', setPortProbeResults),
    [runSocketProbeMatrix]
  );

  const runUdpProbeMatrix = useCallback(
    (host: string, phase: ProbePhase, ports?: number[]) =>
      runSocketProbeMatrix(host, phase, ports, 'udp', 'UDP_PROBE', setUdpProbeResults),
    [runSocketProbeMatrix]
  );
  const runDnsProbeMatrix = useCallback(
    async (hosts: string[], phase: ProbePhase) => {
      if (!hosts || hosts.length === 0) {
        return [];
      }
      appendVpnLog('DNS_PROBE', `${phase}_start`, { hosts });
      if (!vpnPluginAvailable || !NativeVpn?.diagnose) {
        const fallbackRows = hosts.map<DnsProbeRow>((host) => ({
          host,
          success: false,
          latencyMs: null,
          message: 'Диагностика недоступна (NativeVpn)',
        }));
        setDnsProbeResults((previous) => ({
          ...previous,
          [phase]: {
            host: hosts.join(', '),
            phase,
            timestamp: Date.now(),
            rows: fallbackRows,
          },
        }));
        return fallbackRows;
      }
      const rows: DnsProbeRow[] = [];
      for (const target of hosts) {
        try {
          const diagnostic = await NativeVpn.diagnose({
            host: target,
            tests: ['dns'],
            timeoutMs: 5000,
          });
          const entry = diagnostic.results.find(
            (result) => (result.type ?? '').toLowerCase() === 'dns'
          );
          const success = entry?.success ?? false;
          const latencyMs = entry?.latencyMs ?? null;
          const message = entry?.message ?? null;
          rows.push({ host: target, success, latencyMs, message });
          appendVpnLog('DNS_PROBE_RESULT', phase, {
            host: target,
            success,
            latencyMs,
            message,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push({ host: target, success: false, latencyMs: null, message });
          appendVpnLog('DNS_PROBE_ERROR', phase, { host: target, error: message });
        }
      }
      setDnsProbeResults((previous) => ({
        ...previous,
        [phase]: {
          host: hosts.join(', '),
          phase,
          timestamp: Date.now(),
          rows,
        },
      }));
      return rows;
    },
    [appendVpnLog, vpnPluginAvailable]
  );

  const renderInput = useCallback(
    (
      label: string,
      field: keyof ProxyFormState,
      type: 'text' | 'password' = 'text',
      placeholder?: string,
      extra?: React.InputHTMLAttributes<HTMLInputElement>
    ) => (
      <label className="flex flex-col gap-2 text-sm text-slate-200" key={label}>
        <span className="text-xs uppercase tracking-widest text-slate-400">
          {label}
        </span>
        <input
          className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 outline-none"
          type={type}
          value={form[field] as string}
          placeholder={placeholder}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              [field]: event.target.value,
            }))
          }
          {...extra}
        />
      </label>
    ),
    [form]
  );

  const buildApiContext = useCallback(() => {
    const host = form.host.trim() || PROXY_CONFIG.host;
    const token = form.apiToken.trim() || PROXY_CONFIG.apiToken;
    const primaryBase = normalizeApiBase(form.apiBase, host);
    const fallbackBase = primaryBase.replace(/^https:/, 'http:');
    const candidateBases = primaryBase === fallbackBase ? [primaryBase] : [primaryBase, fallbackBase];
    return { host, token, candidateBases };
  }, [form.apiBase, form.apiToken, form.host]);

  const diagHost = useMemo(() => form.host.trim() || PROXY_CONFIG.host, [form.host]);
  const diagApiBase = useMemo(
    () => normalizeApiBase(form.apiBase, diagHost),
    [form.apiBase, diagHost]
  );
  const fullTestLabels = useMemo<Record<FullTestType, string>>(
    () => ({
      ping: `PING ${diagHost}`,
      dns: `DNS ${diagHost}`,
      tcp: `TCP ${diagHost}:${DEFAULT_API_TCP_PORT}`,
      http: 'HTTP api.ipify.org',
      https: 'HTTPS api.ipify.org',
      api_tls: `TLS ${diagApiBase}/system/info`,
    }),
    [diagApiBase, diagHost]
  );

  const callServerApi = useCallback(
    async (path: string, options: CallServerApiOptions = {}): Promise<ApiCallResult> => {
      const { token, candidateBases } = buildApiContext();
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const method = (options.method ?? 'GET').toUpperCase() as CallServerApiOptions['method'];
      const headers: Record<string, string> = {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'X-Auth-Token': token ?? '',
      };
      const body = options.body ?? null;
      const methodSupportsBody = method !== 'GET' && method !== 'DELETE';
      const shouldSendBody = methodSupportsBody && body !== null;
      if (shouldSendBody) {
        headers['Content-Type'] = 'application/json';
      }
      try {
        let lastError: Error | null = null;
        for (const base of candidateBases) {
          const url = `${base}${normalizedPath}`;
          const started = Date.now();
          try {
            const response = await CapacitorHttp.request({
              url,
              method,
              headers,
              data: shouldSendBody ? JSON.stringify(body) : undefined,
            });
            if ((response.status ?? 200) >= 400) {
              throw new Error(`HTTP ${response.status} for ${normalizedPath}`);
            }
            const data = response.data ?? null;
            appendVpnLog('API', 'success', {
              path: normalizedPath,
              durationMs: Date.now() - started,
              description: options.description ?? null,
              base,
            });
            appendVpnLog('API_VERBOSE', 'payload', {
              path: normalizedPath,
              preview: buildPayloadPreview(data),
            });
            return { data, apiBase: base, tokenUsed: token };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendVpnLog('API_ERROR', 'request_failed', {
              url,
              description: options.description ?? null,
              error: message,
            });
            lastError = error instanceof Error ? error : new Error(message);
            if (!message.toLowerCase().includes('tls packet header') || base.startsWith('http://')) {
              break;
            }
          }
        }
        throw lastError ?? new Error('API request failed');
      } catch (error) {
        throw error;
      }
    },
    [appendVpnLog, buildApiContext]
  );

  const loadProbePorts = useCallback(async (): Promise<number[]> => {
    setProbePortList([...ENDPOINT_PORT_PROBES]);
    appendVpnLog('PROBE_PORTS', 'static_list_applied', {
      count: ENDPOINT_PORT_PROBES.length,
    });
    return [...ENDPOINT_PORT_PROBES];
  }, [appendVpnLog]);

  const resolveDeviceId = useCallback(async (): Promise<string> => {
    if (deviceIdRef.current) {
      return deviceIdRef.current;
    }
    if (typeof Device.getId === 'function') {
      try {
        const response = await Device.getId();
        if (response.identifier) {
          persistDeviceId(response.identifier);
          deviceIdRef.current = response.identifier;
          appendVpnLog('DEVICE_ID', 'resolved from capacitor', {
            source: response.type ?? 'unknown',
          });
          return response.identifier;
        }
      } catch (error) {
        appendVpnLog('DEVICE_ID', 'capacitor getId failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const fallback = `device-${Date.now()}`;
    persistDeviceId(fallback);
    deviceIdRef.current = fallback;
    appendVpnLog('DEVICE_ID', 'fallback generated', { deviceId: fallback });
    return fallback;
  }, [appendVpnLog]);

  const performWireGuardPreflight = useCallback(
    async (): Promise<WireGuardPreflightResult> => {
      const deviceId = await resolveDeviceId();
      appendVpnLog('VPN_PREFLIGHT', 'requesting profile', { deviceId }, true);
      updateChecklistStep('serverHealth', 'in_progress', 'Запрос профиля WireGuard');
      updateChecklistStep('profileReady', 'pending', 'Ждём профиль от API');
      const [profileResponse, wgStatusResponse] = await Promise.all([
        callServerApi('/oneclick', {
          method: 'POST',
          description: 'wireguard_profile_request',
          body: { device_id: deviceId },
        }),
        callServerApi('/wg/status', {
          method: 'GET',
          description: 'wg_status_preflight',
        }),
      ]);
      const profilePayload = (profileResponse.data ?? {}) as {
        config?: string;
        reused?: boolean;
        ip?: string;
        name?: string;
        public_key?: string;
      };
      const rawConfig = typeof profilePayload.config === 'string' ? profilePayload.config : null;
      if (!rawConfig) {
        appendVpnLog(
          'VPN_PREFLIGHT_ERROR',
          'missing config in /oneclick response',
          profilePayload,
          true
        );
        updateChecklistStep('serverHealth', 'error', 'API не вернул профиль');
        throw new Error('WireGuard profile is missing in API response');
      }
      const normalizedConfig = normalizeWireGuardConfig(rawConfig);
      const endpointInfo = extractEndpointInfo(normalizedConfig);
      if (!endpointInfo) {
        updateChecklistStep('profileReady', 'error', 'Endpoint отсутствует в профиле');
        throw new Error('Endpoint is missing in the WireGuard profile');
      }
      const dnsMatrix = await runDnsProbeMatrix(DNS_PROBE_HOSTS, 'pre');
      const dnsHealthy = dnsMatrix.some((row) => row.success);
      updateChecklistStep(
        'dnsReady',
        dnsHealthy ? 'success' : 'error',
        dnsHealthy
          ? `Resolved: ${dnsMatrix
              .filter((row) => row.success)
              .map((row) => row.host)
              .join(', ')}`
          : 'DNS не отвечает (до подключения)'
      );
      const availablePorts = await loadProbePorts();
      void runUdpProbeMatrix(endpointInfo.host, 'pre', availablePorts);
      const defaultPortMatrix = await runPortProbeMatrix(endpointInfo.host, 'pre', [
        endpointInfo.port,
      ]);
      const defaultReachable = defaultPortMatrix.find((row) => row.success);
      let fallbackMatrix: PortProbeRow[] = [];
      let fallbackReachable: PortProbeRow | undefined;
      if (portFallbackEnabled && !defaultReachable) {
        fallbackMatrix = await runPortProbeMatrix(endpointInfo.host, 'pre', availablePorts);
        fallbackReachable = fallbackMatrix.find((row) => row.success);
      }
      const reachablePort = defaultReachable ?? fallbackReachable;
      const endpointDetail = reachablePort
        ? `TCP ${reachablePort.port} (${reachablePort.latencyMs ?? '?'} мс)`
        : portFallbackEnabled
        ? 'Нет доступных портов (до подключения)'
        : `Порт ${endpointInfo.port} недоступен (fallback отключён)`;
      updateChecklistStep('endpointReachable', reachablePort ? 'success' : 'error', endpointDetail);

      const defaultInUse = Boolean(defaultReachable);
      const effectiveEndpointInfo =
        defaultInUse || !portFallbackEnabled
          ? endpointInfo
          : reachablePort
          ? { ...endpointInfo, port: reachablePort.port }
          : endpointInfo;
      const shouldOverride =
        portFallbackEnabled &&
        !defaultInUse &&
        reachablePort &&
        reachablePort.port !== endpointInfo.port;
      const configText = shouldOverride
        ? overrideWireGuardEndpoint(normalizedConfig, effectiveEndpointInfo)
        : normalizedConfig;
      const serverListenPort = extractListenPortFromSummary(wgStatusResponse.data);
      const reused = Boolean(profilePayload.reused);
      appendVpnLog(
        'VPN_PREFLIGHT',
        reused ? 'profile reused from cache' : 'new profile issued',
        {
          deviceId,
          endpointPort: effectiveEndpointInfo.port,
          profilePort: endpointInfo.port,
          serverListenPort: serverListenPort ?? 'n/a',
          profileIp: profilePayload.ip ?? 'n/a',
          profileName: profilePayload.name ?? 'n/a',
          endpointPortOverridden: shouldOverride || undefined,
          portFallbackEnabled,
        },
        true
      );
      updateChecklistStep(
        'serverHealth',
        'success',
        reused ? 'Профиль получен из кэша' : 'Профиль выдан заново'
      );
      updateChecklistStep(
        'profileReady',
        'success',
        `${effectiveEndpointInfo.host}:${effectiveEndpointInfo.port}`
      );
      if (
        !reachablePort &&
        serverListenPort &&
        endpointInfo.port &&
        serverListenPort !== endpointInfo.port
      ) {
        appendVpnLog(
          'VPN_PREFLIGHT_ERROR',
          'server ListenPort differs from client Endpoint',
          {
            server: serverListenPort,
            profile: endpointInfo.port,
          },
          true
        );
        updateChecklistStep('profileReady', 'error', 'ListenPort не совпадает');
        throw new Error(
          `Server ListenPort (${serverListenPort}) differs from profile Endpoint (${endpointInfo.port}). Update the client profile before enabling VPN.`
        );
      }
      const result: WireGuardPreflightResult = {
        configText,
        endpointInfo: effectiveEndpointInfo,
        serverListenPort,
        profileMeta: {
          deviceId,
          reused,
          ip: profilePayload.ip ?? null,
          name: profilePayload.name ?? null,
          publicKey:
            typeof profilePayload.public_key === 'string' ? profilePayload.public_key : null,
        },
      };
      setLastProfileResult(result);
      return result;
    },
    [
      appendVpnLog,
      callServerApi,
      loadProbePorts,
      overrideWireGuardEndpoint,
      portFallbackEnabled,
      resolveDeviceId,
      runDnsProbeMatrix,
      runUdpProbeMatrix,
      runPortProbeMatrix,
      setLastProfileResult,
      updateChecklistStep,
    ]
  );

  const verifyEndpointReachability = useCallback(
    async (endpoint: WireGuardEndpointInfo) => {
      updateChecklistStep(
        'endpointReachable',
        'in_progress',
        `Проверяем ping/tcp ${endpoint.host}:${endpoint.port}`
      );
      if (!vpnPluginAvailable || typeof NativeVpn.diagnose !== 'function') {
        updateChecklistStep(
          'endpointReachable',
          'success',
          'Диагностика недоступна, пропускаем'
        );
        return;
      }
      try {
        const diagnostic = await NativeVpn.diagnose({
          host: endpoint.host,
          port: endpoint.port,
          tests: ['ping', 'tcp'],
          timeoutMs: 6000,
        });
        const summary = diagnostic.results
          .filter(
            (entry) =>
              typeof entry.type === 'string' &&
              (entry.type.toLowerCase() === 'ping' || entry.type.toLowerCase() === 'tcp')
          )
          .map(
            (entry) =>
              `${entry.type?.toUpperCase() ?? 'TEST'}:${entry.success ? 'ok' : 'fail'}${
                entry.latencyMs ? ` (${entry.latencyMs}ms)` : ''
              }`
          )
          .join(' | ');
        const failed = diagnostic.results.some(
          (entry) =>
            (entry.type === 'ping' || entry.type === 'tcp') &&
            entry.success === false
        );
        updateChecklistStep(
          'endpointReachable',
          failed ? 'error' : 'success',
          summary || (failed ? 'Проблемы с ping/tcp' : 'Диагностика успешна')
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateChecklistStep('endpointReachable', 'error', message);
      }
    },
    [updateChecklistStep, vpnPluginAvailable]
  );

  const handleTestBlockUdp = useCallback(async () => {
    setTestBlockInProgress(true);
    setTestBlockStatus(
      'Шаги: 1) заблокируйте UDP на устройстве/сети. 2) нажмите Test block UDP. 3) дождитесь результатов preflight и запустите VPN на указанном порту.'
    );
    appendVpnLog('TEST_BLOCK_UDP', 'start', null, true);
    try {
      await loadProbePorts();
      const preflight = await performWireGuardPreflight();
      setTestBlockStatus(
        `Тест завершён. Endpoint: ${preflight.endpointInfo.host}:${preflight.endpointInfo.port}. Проверьте логи endpointPortOverridden и стабильность DNS/TCP внутри туннеля.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('TEST_BLOCK_UDP', 'error', { error: message }, true);
      setTestBlockStatus(`Ошибка теста: ${message}`);
    } finally {
      setTestBlockInProgress(false);
    }
  }, [appendVpnLog, loadProbePorts, performWireGuardPreflight]);

  const togglePortFallback = useCallback(() => {
    setPortFallbackEnabled((previous) => {
      const next = !previous;
      appendVpnLog('PORT_FALLBACK', next ? 'enabled' : 'disabled', {
        source: 'manual_toggle',
      });
      return next;
    });
  }, [appendVpnLog]);

  const runExternalIpDiscovery = useCallback(async () => {
    const attempts: string[] = [];
    let firstSuccess: { ip: string; source: string } | null = null;
    for (let index = 0; index < IP_DISCOVERY_PROBES.length; index += 1) {
      const probe = IP_DISCOVERY_PROBES[index];
      appendVpnLog('IP_DISCOVERY', 'attempt_start', {
        id: probe.id,
        label: probe.label,
        url: probe.url,
      });
      try {
        const response = await CapacitorHttp.request({
          url: probe.url,
          method: 'GET',
          headers: {
            Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          },
        });
        const status = response.status ?? 200;
        if (status >= 400) {
          const message = `HTTP ${status}`;
          attempts.push(`${probe.label}: ${message}`);
          appendVpnLog('IP_DISCOVERY', 'http_error', {
            id: probe.id,
            url: probe.url,
            status,
          });
        } else {
          const ip = parseExternalIp(probe, response.data ?? null);
          if (ip && ip.length > 2) {
            attempts.push(`${probe.label}: ${ip}`);
            appendVpnLog('IP_DISCOVERY', 'success', {
              id: probe.id,
              url: probe.url,
              ip,
              status,
            });
            if (!firstSuccess) {
              firstSuccess = { ip, source: probe.label };
            }
          } else {
            attempts.push(`${probe.label}: invalid response`);
            appendVpnLog('IP_DISCOVERY', 'invalid_response', {
              id: probe.id,
              url: probe.url,
              status,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(`${probe.label}: ${message}`);
        appendVpnLog('IP_DISCOVERY', 'error', {
          id: probe.id,
          url: probe.url,
          error: message,
        });
      }
      if (index < IP_DISCOVERY_PROBES.length - 1) {
        await sleep(IP_DISCOVERY_DELAY_MS);
      }
    }
    appendVpnLog('IP_DISCOVERY', 'sequence_complete', {
      success: Boolean(firstSuccess),
      attempts: IP_DISCOVERY_PROBES.length,
      detail: attempts.join(' | '),
    });
    return {
      ip: firstSuccess?.ip ?? null,
      source: firstSuccess?.source ?? null,
      log: attempts.join(' | '),
    };
  }, [appendVpnLog]);

  const refreshExternalIp = useCallback(async () => {
    updateChecklistStep('ipUpdated', 'in_progress', 'Запрос внешнего IP');
    const discovery = await runExternalIpDiscovery();
    if (discovery.ip) {
      if (!initialIp) {
        setInitialIp(discovery.ip);
      }
      setCurrentIp(discovery.ip);
      setIpSourceLabel(discovery.source ?? 'ip discovery');
      setIpError(null);
      appendVpnLog('IP', 'external IP updated', {
        ip: discovery.ip,
        source: discovery.source ?? 'ip discovery',
      });
      updateChecklistStep(
        'ipUpdated',
        'success',
        `${discovery.ip} (${discovery.source ?? 'ip discovery'})`
      );
      return discovery.ip;
    }
    const combined = discovery.log || 'Не удалось получить IP';
    setIpError(combined);
    setIpSourceLabel(null);
    appendVpnLog('IP_ERROR', 'failed to detect IP', { error: combined });
    updateChecklistStep('ipUpdated', 'error', combined);
    return null;
  }, [appendVpnLog, initialIp, runExternalIpDiscovery, updateChecklistStep]);

  const refreshStatus = useCallback(
    async (options: { reason: RefreshReason; silent?: boolean } = { reason: 'manual' }) => {
      setWarning(null);
      if (!options.silent) {
        setRefreshing(true);
      }
      const startedAt = Date.now();
      appendVpnLog('STATUS', 'refresh_start', { reason: options.reason });
      const result: ServerMetrics = {
        proxyStatus: null,
        wireguardStatus: null,
        systemInfo: null,
        updatedAt: null,
      };
      try {
        const [proxyResponse, wgResponse, systemResponse] = await Promise.all([
          callServerApi('/proxy/status', { method: 'GET' }),
          callServerApi('/wg/status', { method: 'GET' }),
          callServerApi('/system/info', { method: 'GET' }),
        ]);
        result.proxyStatus = proxyResponse.data;
        result.wireguardStatus = wgResponse.data;
        result.systemInfo = systemResponse.data;
        result.updatedAt = Date.now();
        setServerMetrics(result);
        setTraffic(deriveTrafficMetrics(proxyResponse.data));
        setStatusReport(
          buildEnvironmentReport(runtime, form, result, runtime.enabled)
        );
        updateChecklistStep(
          'routingReady',
          'success',
          `Статус обновлён ${formatTimestamp(result.updatedAt)}`
        );
        const handshakeAge = extractHandshakeAgeSeconds(wgResponse.data);
        if (handshakeAge == null) {
          updateChecklistStep('handshake', 'pending', 'Нет данных от wg show');
        } else if (handshakeAge <= HANDSHAKE_FRESH_THRESHOLD_SEC) {
          updateChecklistStep('handshake', 'success', `последнее ${handshakeAge} сек назад`);
        } else {
          updateChecklistStep(
            'handshake',
            'error',
            `рукопожатие ${handshakeAge} сек назад`
          );
        }
        appendVpnLog('STATUS', 'refresh_success', {
          reason: options.reason,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setWarning(`Не удалось обновить статус: ${message}`);
        appendVpnLog('STATUS_ERROR', 'refresh_failed', {
          reason: options.reason,
          error: message,
        });
        updateChecklistStep('routingReady', 'error', message);
        updateChecklistStep('handshake', 'error', 'Нет данных от сервера');
      } finally {
        if (!options.silent) {
          setRefreshing(false);
        }
      }
    },
    [appendVpnLog, callServerApi, form, runtime, updateChecklistStep]
  );

  useEffect(() => {
    refreshExternalIp().catch(() => {
      /* already logged */
    });
  }, [refreshExternalIp]);

  useEffect(() => {
    void refreshStatus({ reason: 'auto', silent: true });
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    pollingRef.current = setInterval(() => {
      void refreshStatus({ reason: 'auto', silent: true });
    }, STATUS_REFRESH_INTERVAL);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [refreshStatus]);

  
  const handleEnableProxy = useCallback(async () => {
    if (!vpnPluginAvailable || !isNativePlatform) {
      setWarning('VPN доступен только в нативной сборке');
      return;
    }
    setLoading(true);
    setVpnError(null);
    resetConnectionChecklist('pending');
    appendVpnLog('VPN', 'enable_request', null, true);
    updateChecklistStep('tunnelUp', 'pending', 'Готовим запуск NativeVpn');
    try {
      const preflight = await performWireGuardPreflight();
      await verifyEndpointReachability(preflight.endpointInfo);
      const configBase64 = encodeUtf8Base64(preflight.configText);
      const vpnResult = await NativeVpn.start({
        wireguardConfigBase64: configBase64,
      });
      setVpnState(vpnResult);
      appendVpnLog('VPN', 'started', {
        running: vpnResult.running,
        endpoint: preflight.endpointInfo,
      });
      updateChecklistStep(
        'tunnelUp',
        vpnResult.running ? 'success' : 'error',
        vpnResult.running ? 'NativeVpn активен' : 'NativeVpn не запустился'
      );
      setRuntime((previous) => ({
        ...previous,
        enabled: vpnResult.running,
        host: preflight.endpointInfo.host,
        port: preflight.endpointInfo.port,
        connectedAt: vpnResult.running ? Date.now() : null,
        apiBase: normalizeApiBase(form.apiBase, form.host),
        apiToken: form.apiToken.trim() || PROXY_CONFIG.apiToken,
      }));
      void refreshStatus({ reason: 'manual', silent: true });
      void runPortProbeMatrix(preflight.endpointInfo.host, 'post').then((rows) => {
        const reachable = rows.find((row) => row.success);
        if (reachable) {
          updateChecklistStep(
            'endpointReachable',
            'success',
            `Внутри туннеля: TCP ${reachable.port} (${reachable.latencyMs ?? '?'} мс)`
          );
        } else {
          updateChecklistStep(
            'endpointReachable',
            'error',
            'Нет доступных портов внутри туннеля'
          );
        }
      });
      void runDnsProbeMatrix(DNS_PROBE_HOSTS, 'post').then((rows) => {
        const okHosts = rows.filter((row) => row.success).map((row) => row.host);
        updateChecklistStep(
          'dnsReady',
          okHosts.length > 0 ? 'success' : 'error',
          okHosts.length > 0
            ? `DNS (внутри туннеля): ${okHosts.join(', ')}`
            : 'DNS внутри туннеля не отвечает'
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVpnError(message);
      appendVpnLog('VPN_ERROR', 'start_failed', { error: message }, true);
      updateChecklistStep('tunnelUp', 'error', message);
    } finally {
      setLoading(false);
    }
  }, [
    appendVpnLog,
    form.apiBase,
    form.apiToken,
    form.host,
    isNativePlatform,
    performWireGuardPreflight,
    runDnsProbeMatrix,
    runUdpProbeMatrix,
    runPortProbeMatrix,
    refreshStatus,
    resetConnectionChecklist,
    updateChecklistStep,
    verifyEndpointReachability,
    vpnPluginAvailable,
  ]);

const handleDisableProxy = useCallback(async () => {
    if (!vpnPluginAvailable || !isNativePlatform) {
      return;
    }
    setLoading(true);
    setVpnError(null);
    appendVpnLog('VPN', 'disable_request', null, true);
      try {
        const state = await NativeVpn.stop();
        setVpnState(state);
        appendVpnLog('VPN', 'stopped', { exitCode: state?.exitCode ?? 'n/a' });
        updateChecklistStep('tunnelUp', 'idle', 'Туннель отключен пользователем');
        setRuntime((previous) => ({
          ...previous,
          enabled: false,
          connectedAt: null,
          lastError: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVpnError(message);
      appendVpnLog('VPN_ERROR', 'stop_failed', { error: message }, true);
    } finally {
      setLoading(false);
    }
    }, [appendVpnLog, isNativePlatform, updateChecklistStep, vpnPluginAvailable]);

const handleServerSnapshot = useCallback(async () => {
    setDiagProgress('Собираем снимок сервера...');
    try {
      const response = await callServerApi('/diag/server-snapshot', {
        method: 'POST',
        description: 'server_diag_snapshot',
      });
      appendVpnLog('SERVER_SNAPSHOT', 'collected', {
        preview: buildPayloadPreview(response.data),
      });
      setDiagProgress('Снимок сервера готов');
      setWarning(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('SERVER_SNAPSHOT_ERROR', 'failed', { error: message }, true);
      setDiagProgress(`Ошибка снимка сервера: ${message}`);
      setWarning(`Снимок сервера: ${message}`);
    }
  }, [appendVpnLog, callServerApi]);
  const shareStatus = useCallback(async () => {
    const report = buildEnvironmentReport(runtime, form, serverMetrics, runtime.enabled);
    try {
      if (Capacitor.getPlatform() === 'web') {
        await Filesystem.writeFile({
          path: `vpn-status-${Date.now()}.txt`,
          data: report,
          encoding: FilesystemEncoding.UTF8,
          directory: Directory.Documents,
        });
      } else {
        await Share.share({
          title: 'VPN status',
          text: report,
          dialogTitle: 'Поделиться состоянием сервера',
        });
      }
      appendVpnLog('STATUS', 'report exported');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('STATUS_ERROR', 'failed to export status', { error: message });
    }
  }, [appendVpnLog, form, runtime, serverMetrics]);

  const handlePing = useCallback(async () => {
    if (!vpnPluginAvailable || !isNativePlatform || typeof NativeVpn.diagnose !== 'function') {
      setDiagProgress('Диагностика доступна только в нативной версии приложения');
      return;
    }
    setDiagnosticsRunning(true);
    setDiagProgress('Запускаем полный тест (PING/DNS/TCP + HTTP/HTTPS + TLS)...');
    resetDiagResults('pending');
    setLastDiagAt(null);
    appendVpnLog('DIAG', 'full_test_requested', {
      host: diagHost,
      tcpPort: DEFAULT_API_TCP_PORT,
    });
    try {
      const request: VpnDiagnosticRequest = {
        host: diagHost,
        port: DEFAULT_API_TCP_PORT,
        tests: ['ping', 'dns', 'tcp', 'http', 'https'],
        timeoutMs: 8000,
      };
      const diagnostic = await NativeVpn.diagnose(request);
      const upcomingResults = buildInitialDiagResults();
      FULL_TEST_TYPES.forEach((id) => {
        upcomingResults[id] = { status: 'pending' };
      });
      if (diagHost) {
        void runUdpProbeMatrix(diagHost, 'post');
      }
      let processed = 0;
      const totalTracked = FULL_TEST_TYPES.length;
      diagnostic.results.forEach((entry: VpnDiagnosticEntry) => {
        const normalized = (entry.type ?? '').toLowerCase();
        appendVpnLog('DIAG_RESULT', 'full_test', {
          type: entry.type,
          success: entry.success,
          latencyMs: entry.latencyMs,
          status: entry.status ?? null,
          message: entry.message ?? null,
        });
        if (isFullTestType(normalized)) {
          processed += 1;
          upcomingResults[normalized] = {
            status: entry.success ? 'success' : 'error',
            latencyMs: entry.latencyMs ?? null,
            message: entry.message ?? null,
          };
          setDiagProgressValue(Math.min(processed / totalTracked, 1));
        }
      });
      if (FULL_TEST_TYPES.includes('api_tls')) {
        const tlsBase = diagApiBase;
        const token = form.apiToken.trim() || PROXY_CONFIG.apiToken;
        setDiagProgress(`Проверяем TLS API (${tlsBase}/system/info)...`);
        try {
          const startedTls = Date.now();
          const response = await CapacitorHttp.request({
            url: `${tlsBase}/system/info`,
            method: 'GET',
            headers: {
              Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
              'X-Auth-Token': token ?? '',
            },
          });
          const ok = (response.status ?? 200) < 400;
          const latency = Date.now() - startedTls;
          appendVpnLog('DIAG_RESULT', 'tls_api_test', {
            base: tlsBase,
            success: ok,
            latencyMs: latency,
            status: response.status ?? null,
          });
          upcomingResults.api_tls = {
            status: ok ? 'success' : 'error',
            latencyMs: latency,
            message: ok ? tlsBase : `HTTP ${response.status ?? 'ERR'}`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appendVpnLog('DIAG_RESULT', 'tls_api_test', {
            success: false,
            message,
          });
          upcomingResults.api_tls = { status: 'error', message };
        }
      }
      FULL_TEST_TYPES.forEach((id) => {
        if (upcomingResults[id].status === 'pending') {
          upcomingResults[id] = { status: 'error', message: 'Нет данных от диагностики' };
        }
      });
      setDiagResults(upcomingResults);
      setLastDiagAt(Date.now());
      setDiagProgressValue(1);
      setDiagProgress('Полный тест завершён');
      await refreshExternalIp();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('DIAG_ERROR', 'full_test_failed', { error: message });
      setDiagProgress(`Ошибка полного теста: ${message}`);
      setDiagProgressValue(0);
      setDiagResults((prev) => {
        const failed = { ...prev };
        Object.keys(failed).forEach((key) => {
          if (failed[key as FullTestType].status === 'pending') {
            failed[key as FullTestType] = {
              status: 'error',
              message,
            };
          }
        });
        return failed;
      });
    } finally {
      setDiagnosticsRunning(false);
    }
  }, [
    appendVpnLog,
    diagApiBase,
    diagHost,
    form.apiToken,
    isNativePlatform,
    refreshExternalIp,
    resetDiagResults,
    vpnPluginAvailable,
  ]);

  const handleShareLog = useCallback(async () => {
    if (vpnLog.length === 0) {
      setDiagProgress('Журнал пока пуст — включите VPN или запустите тест.');
      return;
    }
    const fileName = `wireguard-log-${Date.now()}.txt`;
    const directory = Directory.Cache;
    try {
      await Filesystem.writeFile({
        path: fileName,
        data: vpnLog.join('\n'),
        encoding: FilesystemEncoding.UTF8,
        directory,
      });
      let shareUrl: string | undefined;
      if (typeof Filesystem.getUri === 'function' && Capacitor.getPlatform() !== 'web') {
        const uri = await Filesystem.getUri({ directory, path: fileName });
        shareUrl = uri.uri;
      } else {
        const fileData = await Filesystem.readFile({ directory, path: fileName });
        shareUrl = `data:text/plain;base64,${fileData.data}`;
      }
      await Share.share({
        title: 'WireGuard журнал',
        text: 'Во вложении файл журнала.',
        url: shareUrl,
        dialogTitle: 'Поделиться журналом',
      });
      appendVpnLog('LOG', 'shared_file', { fileName, lines: vpnLog.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('LOG_ERROR', 'share_failed', { error: message });
      setDiagProgress(`Не удалось поделиться журналом: ${message}`);
    }
  }, [appendVpnLog, vpnLog]);

  const profileCards = useMemo<{
    interfaceCard: ProfileCardData;
    peerCard: ProfileCardData;
  } | null>(() => {
    if (!lastProfileResult) {
      return null;
    }
    const { configText, endpointInfo, profileMeta } = lastProfileResult;
    const ensureValue = (value?: string | null) =>
      value && value.trim().length > 0 ? value.trim() : 'н/д';
    const interfaceName = ensureValue(profileMeta.name ?? profileMeta.deviceId);
    const interfacePublicKey = ensureValue(profileMeta.publicKey);
    const interfaceAddress = ensureValue(readConfigValue(configText, 'Address'));
    const interfaceDns = ensureValue(readConfigValue(configText, 'DNS'));
    const peerPublicKey = ensureValue(readConfigValue(configText, 'PublicKey'));
    const configAllowedIps = readConfigValue(configText, 'AllowedIPs');
    const peerSummary = extractPeerSummaryDetails(
      serverMetrics.wireguardStatus,
      profileMeta.publicKey
    );
    const allowedIps =
      peerSummary?.allowedIps ?? configAllowedIps ?? DEFAULT_WIREGUARD_ALLOWED_IPS;
    const endpointLabel =
      peerSummary?.endpoint ?? `${endpointInfo.host}:${endpointInfo.port}`;
    const statsLabel =
      peerSummary?.transferReceived && peerSummary?.transferSent
        ? `Принято: ${peerSummary.transferReceived}, Передано: ${peerSummary.transferSent}`
        : peerSummary?.transferRaw ?? 'н/д';
    const handshakeLabel = peerSummary?.latestHandshake ?? 'н/д';
    return {
      interfaceCard: {
        title: 'Интерфейс',
        fields: [
          { label: 'Название', value: interfaceName },
          { label: 'Публичный ключ', value: interfacePublicKey, monospace: true },
          { label: 'Адреса', value: interfaceAddress },
          { label: 'DNS-серверы', value: interfaceDns },
        ],
      },
      peerCard: {
        title: 'Пир',
        fields: [
          { label: 'Публичный ключ', value: peerPublicKey, monospace: true },
          { label: 'Разрешённые IP-адреса', value: ensureValue(allowedIps) },
          { label: 'Конечная точка', value: ensureValue(endpointLabel) },
          { label: 'Статистика', value: statsLabel },
          { label: 'Последнее рукопожатие', value: handshakeLabel },
        ],
      },
    };
  }, [lastProfileResult, serverMetrics.wireguardStatus]);

  const runtimeDuration = useMemo(() => {
    if (!runtime.connectedAt || !runtime.enabled) {
      return 'n/a';
    }
    const durationMs = Date.now() - runtime.connectedAt;
    const seconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds - hours * 3600) / 60);
    const remainingSeconds = seconds - hours * 3600 - minutes * 60;
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
  }, [runtime.connectedAt, runtime.enabled]);

  const vpnRunning = runtime.enabled;
  const canStart = !vpnRunning && !loading;
  const canStop = vpnRunning && !loading;
  const canRefresh = !refreshing && !loading;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-black border border-emerald-500/20 shadow-[0_25px_60px_rgba(16,185,129,0.15)] backdrop-blur-xl p-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold text-white">WireGuard сервер</h2>
            <p className="text-sm text-slate-400">
              Следим за конфигом, портами и логами перед запуском туннеля.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="neutral" onClick={onBack}>
              Назад
            </Button>
            <Button variant="neutral" onClick={onShowLogs}>
              Общие логи
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {renderInput('Host', 'host', 'text', '45.151.183.153')}
          {renderInput('API token', 'apiToken', 'text', 'e55757...', {
            autoComplete: 'off',
          })}
          {renderInput('API base (https://host:8787)', 'apiBase', 'text', 'https://host:8787')}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="neutral"
            disabled={!canStart}
            onClick={handleEnableProxy}
            className="bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/30"
          >
            {loading && !vpnRunning ? 'Запрашиваем профиль...' : 'Включить VPN'}
          </Button>
          <Button
            variant="neutral"
            disabled={!canStop}
            onClick={handleDisableProxy}
            className="bg-rose-500 text-white hover:bg-rose-400 shadow-lg shadow-rose-500/30"
          >
            {loading && vpnRunning ? 'Отключаем...' : 'Выключить VPN'}
          </Button>
          <Button
            variant="neutral"
            disabled={!canRefresh}
            onClick={() => void refreshStatus({ reason: 'manual' })}
            className="bg-sky-500/80 text-white hover:bg-sky-400 shadow-md shadow-sky-500/30"
          >
            {refreshing ? 'Обновляем...' : 'Обновить статус'}
          </Button>
          <Button
            variant="neutral"
            disabled={diagnosticsRunning}
            onClick={handlePing}
            className="bg-violet-500/80 text-white hover:bg-violet-400 shadow-md shadow-violet-500/30"
          >
            {diagnosticsRunning ? 'Полный тест…' : 'Полный тест'}
          </Button>
          <Button
            variant="neutral"
            onClick={handleServerSnapshot}
            className="bg-amber-500/80 text-slate-900 hover:bg-amber-400 shadow-md shadow-amber-500/30"
          >
            Снимок сервера
          </Button>
          <Button
            variant="neutral"
            onClick={() => void refreshExternalIp()}
            className="bg-cyan-500/80 text-slate-900 hover:bg-cyan-400 shadow-md shadow-cyan-500/30"
          >
            Обновить новый IP
          </Button>
          <Button
            variant="neutral"
            onClick={shareStatus}
            className="bg-fuchsia-500/80 text-white hover:bg-fuchsia-400 shadow-md shadow-fuchsia-500/30"
          >
            Поделиться статусом
          </Button>
          <Button
            variant="neutral"
            onClick={handleShareLog}
            className="bg-indigo-500/80 text-white hover:bg-indigo-400 shadow-md shadow-indigo-500/30"
          >
            Поделиться журналом
          </Button>
        </div>

        {warning && <p className="text-amber-400 text-sm">{warning}</p>}
        {vpnError && <p className="text-rose-400 text-sm">{vpnError}</p>}
        {diagProgress && <p className="text-slate-300 text-sm">{diagProgress}</p>}
      </section>

      <section className="rounded-3xl bg-slate-950/70 border border-cyan-500/20 p-8 space-y-6 shadow-[0_20px_50px_rgba(6,182,212,0.12)]">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Порты WireGuard (TCP-проверки)</h3>
            <p className="text-sm text-slate-400">
              Помогает понять, какие альтернативные порты доступны до подключения и внутри туннеля.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PROBE_PHASES.map((phase) => {
            const summary = portProbeResults[phase];
            return (
              <div key={phase} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {phase === 'pre' ? 'До подключения' : 'Внутри туннеля'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {summary
                        ? `Хост: ${summary.host} • ${formatTimestamp(summary.timestamp)}`
                        : 'нет данных'}
                    </p>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm text-left text-slate-200">
                    <thead>
                      <tr className="text-xs uppercase text-slate-400">
                        <th className="py-1 pr-2">Порт</th>
                        <th className="py-1 pr-2">Статус</th>
                        <th className="py-1 pr-2">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPortList.map((port) => {
                        const row = summary?.rows.find((item) => item.port === port);
                        const success = row?.success ?? false;
                        return (
                          <tr key={`${phase}-${port}`} className="border-t border-slate-800/60">
                            <td className="py-1 pr-2 font-mono text-xs">{port}</td>
                            <td className="py-1 pr-2 text-xs">
                              {success ? (
                                <span className="text-emerald-300">OK{row?.latencyMs ? ` (${row.latencyMs} мс)` : ''}</span>
                              ) : (
                                <span className="text-rose-300">нет</span>
                              )}
                            </td>
                            <td className="py-1 pr-2 text-xs text-slate-400">
                              {row?.message ?? (success ? 'ответил' : 'нет ответа')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl bg-slate-950/70 border border-fuchsia-500/20 p-8 space-y-6 shadow-[0_20px_50px_rgba(217,70,239,0.12)]">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">DNS-проверки</h3>
            <p className="text-sm text-slate-400">
              Сравниваем доступность ключевых доменов до подключения и внутри туннеля.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PROBE_PHASES.map((phase) => {
            const summary = dnsProbeResults[phase];
            return (
              <div key={`dns-${phase}`} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {phase === 'pre' ? 'До подключения' : 'Внутри туннеля'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {summary ? formatTimestamp(summary.timestamp) : 'нет данных'}
                    </p>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm text-left text-slate-200">
                    <thead>
                      <tr className="text-xs uppercase text-slate-400">
                        <th className="py-1 pr-2">Хост</th>
                        <th className="py-1 pr-2">Статус</th>
                        <th className="py-1 pr-2">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DNS_PROBE_HOSTS.map((host) => {
                        const row = summary?.rows.find((entry) => entry.host === host);
                        const success = row?.success ?? false;
                        return (
                          <tr key={`${phase}-${host}`} className="border-t border-slate-800/60">
                            <td className="py-1 pr-2 text-xs break-all">{host}</td>
                            <td className="py-1 pr-2 text-xs">
                              {success ? (
                                <span className="text-emerald-300">OK{row?.latencyMs ? ` (${row.latencyMs} мс)` : ''}</span>
                              ) : (
                                <span className="text-rose-300">нет</span>
                              )}
                            </td>
                            <td className="py-1 pr-2 text-xs text-slate-400">
                              {row?.message ?? (success ? 'разрешён' : 'ошибка DNS')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl bg-slate-950/70 border border-emerald-500/20 shadow-[0_18px_40px_rgba(16,185,129,0.12)] p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Чек-лист подключения</h3>
            <p className="text-sm text-slate-400">
              Отслеживаем путь до устойчивого туннеля, шаги автоматически логируются.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Если этап застыл, смотрим журнал (тег CHECKLIST) и серверные логи.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {CONNECTION_CHECKLIST_STEPS.map((step) => {
            const entry = connectionChecklist[step.id];
            const meta = getChecklistStatusMeta(entry?.status ?? 'idle');
            return (
              <div
                key={step.id}
                className={`rounded-2xl border px-4 py-5 transition-colors ${meta.container}`}
              >
                <div
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${meta.pill}`}
                >
                  {meta.label}
                </div>
                <p className="mt-3 text-base font-semibold text-white">{step.label}</p>
                <p className="text-sm text-slate-400">{step.description}</p>
                {entry?.detail && (
                  <p className="mt-2 text-sm text-slate-200 break-words">{entry.detail}</p>
                )}
                {entry?.updatedAt && (
                  <p className="mt-1 text-xs text-slate-500">
                    Обновлено: {formatTimestamp(entry.updatedAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-cyan-500/20 p-8 space-y-6 shadow-[0_20px_50px_rgba(6,182,212,0.15)]">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">WireGuard профиль</h3>
            <p className="text-sm text-slate-400">
              Сводка по последнему выданному конфигу: можно свериться с интерфейсом клиента в одно касание.
            </p>
          </div>
          {lastProfileResult && (
            <p className="text-xs text-slate-400">
              Device ID: {lastProfileResult.profileMeta.deviceId}
            </p>
          )}
        </div>
        {profileCards ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[profileCards.interfaceCard, profileCards.peerCard].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3"
              >
                <p className="text-base font-semibold text-white">{card.title}</p>
                <div className="space-y-3">
                  {card.fields.map((field) => (
                    <div key={`${card.title}-${field.label}`} className="space-y-1">
                      <p className="text-[11px] uppercase tracking-widest text-slate-400">
                        {field.label}
                      </p>
                      <p
                        className={`text-sm text-slate-100 ${
                          field.monospace ? 'font-mono break-all' : 'break-words'
                        }`}
                      >
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Запросите профиль (через preflight или «Включить VPN»), чтобы отобразить ключи и адреса.
          </p>
        )}
      </section>
      <section className="rounded-3xl bg-slate-950/70 border border-emerald-500/20 p-8 space-y-6 shadow-[0_20px_50px_rgba(16,185,129,0.12)]">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Порты WireGuard (UDP-проверки)</h3>
            <p className="text-sm text-slate-400">
              Та же матрица, но через UDP 443 — видно, доступен ли чистый WireGuard до и после подключения.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PROBE_PHASES.map((phase) => {
            const summary = udpProbeResults[phase];
            return (
              <div key={`udp-${phase}`} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {phase === 'pre' ? 'До подключения' : 'Внутри туннеля'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {summary
                        ? `Хост: ${summary.host} • ${formatTimestamp(summary.timestamp)}`
                        : 'нет данных'}
                    </p>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm text-left text-slate-200">
                    <thead>
                      <tr className="text-xs uppercase text-slate-400">
                        <th className="py-1 pr-2">Порт</th>
                        <th className="py-1 pr-2">Статус</th>
                        <th className="py-1 pr-2">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPortList.map((port) => {
                        const row = summary?.rows.find((item) => item.port === port);
                        const success = row?.success ?? false;
                        return (
                          <tr key={`udp-${phase}-${port}`} className="border-t border-slate-800/60">
                            <td className="py-1 pr-2 font-mono text-xs">{port}</td>
                            <td className="py-1 pr-2 text-xs">
                              {success ? (
                                <span className="text-emerald-300">
                                  OK{row?.latencyMs ? ` (${row.latencyMs} мс)` : ''}
                                </span>
                              ) : (
                                <span className="text-rose-300">нет</span>
                              )}
                            </td>
                            <td className="py-1 pr-2 text-xs text-slate-400">
                              {row?.message ?? (success ? 'ответил' : 'нет ответа')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl bg-slate-950/70 border border-slate-800/60 shadow-[0_15px_30px_rgba(15,23,42,0.9)] p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Smart порт</h3>
            <p className="text-sm text-slate-400">
              Держим Endpoint на 45.151.183.153:443 и не прыгаем по нестандартным портам без вашего разрешения.
            </p>
          </div>
          <Button variant="neutral" onClick={togglePortFallback}>
            {portFallbackEnabled ? 'fallback включён' : 'fallback выключен'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Когда fallback выключен, приложение использует только 443. Если когда-нибудь понадобится другой TCP-порт,
          включите fallback — мы попробуем выбрать любой доступный вариант из сервера (сейчас в списке только 443).
        </p>
      </section>

      <section className="rounded-3xl bg-slate-950/70 border border-yellow-400/30 shadow-[0_20px_45px_rgba(234,179,8,0.25)] p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Тест блокировки UDP</h3>
            <p className="text-sm text-slate-400">
              Проверяем устойчивость туннеля, когда UDP полностью заблокирован, и фиксируем
              рабочий TCP-порт.
            </p>
          </div>
          <p className="text-xs text-slate-400 max-w-xs">
            После запуска теста будет показан порт, на котором endpoint остаётся доступен и
            работает DNS/TCP внутри туннеля.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Button
              variant="highlight"
              onClick={handleTestBlockUdp}
              disabled={testBlockInProgress}
            >
              {testBlockInProgress ? 'test block UDP…' : 'test block UDP'}
            </Button>
            <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1">
              <li>Заблокируйте UDP на устройстве/сети (firewall, роутер или локальный фаервол).</li>
              <li>Нажмите кнопку и дождитесь завершения preflight — он подбирает доступный TCP-порт.</li>
              <li>После появления хоста/порта из статуса запустите VPN и проверьте DNS/TCP внутри.</li>
            </ol>
          </div>
          <div className="rounded-2xl border border-yellow-400/40 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-widest text-yellow-300">Статус теста</p>
            <p className="mt-2 text-sm text-slate-200 break-words">
              {testBlockStatus ??
                'Готов к запуску: блокируйте UDP и нажимайте кнопку для тренировки fallback-порта.'}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Лог: тег TEST_BLOCK_UDP и VPN_PREFLIGHT → PORT_PROBE.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-950/70 border border-cyan-500/20 shadow-[0_20px_45px_rgba(0,212,255,0.1)] p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Полный тест</h3>
            <p className="text-sm text-slate-400">
              Ping/DNS/TCP → {diagHost} • HTTP/HTTPS → api.ipify.org • TLS → {diagApiBase}/system/info
            </p>
          </div>
          <div className="text-sm text-slate-300">
            <p>Последний запуск: {lastDiagAt ? formatTimestamp(lastDiagAt) : 'ещё не запускался'}</p>
            <p>Статус: {diagProgress ?? (lastDiagAt ? 'Тест завершён' : 'Ожидает запуска')}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-2 rounded-full bg-slate-800/70 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.round(diagProgressValue * 100))}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            Прогресс: {Math.round(diagProgressValue * 100)}%
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {FULL_TEST_TYPES.map((id) => {
            const result = diagResults[id];
            const meta = getDiagStatusMeta(result.status);
            return (
              <div
                key={id}
                className={`rounded-2xl border px-4 py-5 backdrop-blur ${meta.container}`}
              >
                <div
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${meta.pill}`}
                >
                  {meta.label}
                </div>
                <p className="mt-3 text-base font-medium">{fullTestLabels[id]}</p>
                {result.latencyMs != null && (
                  <p className="text-sm text-slate-200 mt-1">Latency: {result.latencyMs} ms</p>
                )}
                {result.message && (
                  <p className="text-xs text-slate-300 mt-2 break-words">{result.message}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8 border border-cyan-500/15 space-y-4 shadow-[0_15px_45px_rgba(59,130,246,0.12)]">
        <header className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Статус туннеля</h3>
            <p className="text-sm text-slate-400">
              Последняя проверка: {formatTimestamp(serverMetrics.updatedAt)}
            </p>
          </div>
          <div className="flex gap-3 text-sm text-slate-300">
            <span>Состояние: {vpnRunning ? 'активен' : 'выключен'}</span>
            <span>Длительность: {runtimeDuration}</span>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs uppercase tracking-widest text-slate-400">Интерфейс</p>
            <p className="text-sm text-slate-200 break-all">
              {runtime.host ? `${runtime.host}:${runtime.port}` : 'н/д'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs uppercase tracking-widest text-slate-400">Latency</p>
            <p className="text-emerald-300 text-lg">{formatLatency(runtime.latencyMs)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs uppercase tracking-widest text-slate-400">Up</p>
            <p className="text-emerald-300 text-lg">{formatSpeed(traffic.upSpeed)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs uppercase tracking-widest text-slate-400">Down</p>
            <p className="text-emerald-300 text-lg">{formatSpeed(traffic.downSpeed)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 text-sm text-slate-300">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Мой IP (при запуске)</p>
            <p>{initialIp ?? 'не зафиксирован'}</p>
            <p className="text-xs text-slate-400">Снимок захвачен при открытии экрана</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Новый IP (через VPN)</p>
            <p>{currentIp ?? 'нет данных'}</p>
            <p className="text-xs text-slate-400">Источник: {ipSourceLabel ?? 'н/д'} {ipError ? `• Ошибка: ${ipError}` : ''}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">API база</p>
            <p className="break-all">
              {runtime.apiBase || normalizeApiBase(form.apiBase, form.host)}
            </p>
            <p className="text-xs text-slate-400">NO_PROXY: {PROXY_ENV_BYPASS}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-950/70 p-8 border border-violet-500/15 space-y-4 shadow-[0_20px_50px_rgba(139,92,246,0.12)]">
        <header className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">WireGuard лог</h3>
            <p className="text-sm text-slate-400">
              Максимум {MAX_VPN_LOG_ENTRIES} строк, новые записи добавляются автоматически.
            </p>
          </div>
        </header>
        <pre className="max-h-[320px] overflow-auto rounded-2xl bg-slate-950/70 border border-slate-800 p-4 text-xs text-slate-200 font-mono whitespace-pre-wrap">
          {vpnLog.length > 0
            ? vpnLog.join('\n')
            : 'Лог пуст — включите VPN или выполните диагностику.'}
        </pre>
      </section>

      <section className="rounded-3xl bg-slate-950/70 p-8 border border-slate-800/70 space-y-4 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
        <header>
          <h3 className="text-lg font-semibold text-white">Отчёт окружения</h3>
          <p className="text-sm text-slate-400">
            Используйте при обращении в поддержку — содержит текущие ответы API.
          </p>
        </header>
        <textarea
          className="w-full h-64 rounded-2xl bg-slate-950/70 border border-slate-800 p-4 text-xs text-slate-200 font-mono"
          readOnly
          value={
            statusReport ||
            buildEnvironmentReport(runtime, form, serverMetrics, vpnRunning)
          }
        />
      </section>
    </div>
  );
};

export default ServerSettings;
