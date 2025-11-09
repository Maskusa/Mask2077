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

type ProxyMode = 'http' | 'socks' | 'wireguard';
type RefreshReason = 'manual' | 'ping' | 'auto';

interface ServerSettingsProps {
  onBack: () => void;
  onShowLogs: () => void;
  addLog: (message: string) => void;
}

interface ProxyFormState {
  host: string;
  httpPort: string;
  socksPort: string;
  username: string;
  password: string;
  apiBase: string;
  apiToken: string;
  mode: ProxyMode;
}

interface ProxyRuntimeState {
  enabled: boolean;
  proxyType: ProxyMode;
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
  };
}

const DEVICE_ID_STORAGE_KEY = 'vpn_device_id';
const STATUS_REFRESH_INTERVAL = 45_000;
const PROXY_ENV_BYPASS = 'localhost,127.0.0.1';
const DEFAULT_WIREGUARD_DNS = '1.1.1.1, 8.8.8.8';
const DEFAULT_WIREGUARD_MTU = '1280';
const DEFAULT_WIREGUARD_KEEPALIVE = '25';
const DEFAULT_WIREGUARD_ALLOWED_IPS = '0.0.0.0/0, ::/0';
const API_VERBOSE_PREVIEW_LIMIT = 4000;
const MAX_VPN_LOG_ENTRIES = 500;

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
    `Mode   : ${form.mode.toUpperCase()}`,
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
  httpPort: String(PROXY_CONFIG.httpPort ?? 8080),
  socksPort: String(PROXY_CONFIG.socksPort ?? 1080),
  username: '',
  password: '',
  apiBase: '',
  apiToken: PROXY_CONFIG.apiToken ?? '',
  mode: 'wireguard',
};

const ServerSettings: React.FC<ServerSettingsProps> = ({
  onBack,
  onShowLogs,
  addLog,
}) => {
  const [form, setForm] = useState<ProxyFormState>(initialForm);
  const [runtime, setRuntime] = useState<ProxyRuntimeState>({
    enabled: false,
    proxyType: 'wireguard',
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
  const [pinging, setPinging] = useState(false);
  const [vpnLog, setVpnLog] = useState<string[]>([]);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [ipSourceLabel, setIpSourceLabel] = useState<string | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);
  const [statusReport, setStatusReport] = useState('');
  const [diagProgress, setDiagProgress] = useState<string | null>(null);

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
    const apiBase = normalizeApiBase(form.apiBase, host);
    return { host, token, apiBase };
  }, [form.apiBase, form.apiToken, form.host]);

  const callServerApi = useCallback(
    async (path: string, options: CallServerApiOptions = {}): Promise<ApiCallResult> => {
      const { host, token, apiBase } = buildApiContext();
      const base = normalizeApiBase(apiBase, host);
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const url = `${base}${normalizedPath}`;
      const method = (options.method ?? 'GET').toUpperCase() as CallServerApiOptions['method'];
      const headers: Record<string, string> = {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'X-Auth-Token': token ?? '',
      };
      const body = options.body ?? null;
      try {
        const started = Date.now();
        const response = await CapacitorHttp.request({
          url,
          method,
          headers,
          data: body ?? undefined,
        });
        if ((response.status ?? 200) >= 400) {
          throw new Error(`HTTP ${response.status} for ${normalizedPath}`);
        }
        const data = response.data ?? null;
        appendVpnLog('API', 'success', {
          path: normalizedPath,
          durationMs: Date.now() - started,
          description: options.description ?? null,
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
        throw error;
      }
    },
    [appendVpnLog, buildApiContext]
  );

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
      };
      const rawConfig = typeof profilePayload.config === 'string' ? profilePayload.config : null;
      if (!rawConfig) {
        appendVpnLog(
          'VPN_PREFLIGHT_ERROR',
          'missing config in /oneclick response',
          profilePayload,
          true
        );
        throw new Error('WireGuard profile is missing in API response');
      }
      const normalizedConfig = normalizeWireGuardConfig(rawConfig);
      const endpointInfo = extractEndpointInfo(normalizedConfig);
      if (!endpointInfo) {
        throw new Error('Endpoint is missing in the WireGuard profile');
      }
      const serverListenPort = extractListenPortFromSummary(wgStatusResponse.data);
      const reused = Boolean(profilePayload.reused);
      appendVpnLog(
        'VPN_PREFLIGHT',
        reused ? 'profile reused from cache' : 'new profile issued',
        {
          deviceId,
          endpointPort: endpointInfo.port,
          serverListenPort: serverListenPort ?? 'n/a',
          profileIp: profilePayload.ip ?? 'n/a',
          profileName: profilePayload.name ?? 'n/a',
        },
        true
      );
      if (
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
          throw new Error(
            `Server ListenPort (${serverListenPort}) differs from profile Endpoint (${endpointInfo.port}). Update the client profile before enabling VPN.`
          );
      }
      return {
        configText: normalizedConfig,
        endpointInfo,
        serverListenPort,
        profileMeta: {
          deviceId,
          reused,
          ip: profilePayload.ip ?? null,
          name: profilePayload.name ?? null,
        },
      };
    },
    [appendVpnLog, callServerApi, resolveDeviceId]
  );

  const refreshExternalIp = useCallback(async () => {
    const reasons: string[] = [];
    for (const source of EXTERNAL_IP_SOURCES) {
      try {
        const response = await CapacitorHttp.request({
          url: source.url,
          method: 'GET',
          headers: {
            Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          },
        });
        if ((response.status ?? 200) >= 400) {
          reasons.push(`${source.label}: HTTP ${response.status}`);
          continue;
        }
        const ip = parseExternalIp(source, response.data ?? null);
        if (ip && ip.length > 2) {
          setCurrentIp(ip);
          setIpSourceLabel(source.label);
          setIpError(null);
          appendVpnLog('IP', 'external IP updated', { ip, source: source.label });
          return ip;
        }
        reasons.push(`${source.label}: invalid response`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reasons.push(`${source.label}: ${message}`);
      }
    }
    const combined = reasons.join(' | ');
    setIpError(combined);
    setIpSourceLabel(null);
    appendVpnLog('IP_ERROR', 'failed to detect IP', { error: combined });
    return null;
  }, [appendVpnLog]);

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
      } finally {
        if (!options.silent) {
          setRefreshing(false);
        }
      }
    },
    [appendVpnLog, callServerApi, form, runtime]
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
    appendVpnLog('VPN', 'enable_request', null, true);
    try {
      const preflight = await performWireGuardPreflight();
      const configBase64 = encodeUtf8Base64(preflight.configText);
      const vpnResult = await NativeVpn.start({
        host: form.host || PROXY_CONFIG.host,
        httpPort: Number(form.httpPort) || 8080,
        socksPort: Number(form.socksPort) || 1080,
        username: form.username,
        password: form.password,
        mode: 'HTTP',
        wireguardConfigBase64: configBase64,
      });
      setVpnState(vpnResult);
      appendVpnLog('VPN', 'started', {
        running: vpnResult.running,
        endpoint: preflight.endpointInfo,
      });
      setRuntime((previous) => ({
        ...previous,
        enabled: vpnResult.running,
        proxyType: 'wireguard',
        host: preflight.endpointInfo.host,
        port: preflight.endpointInfo.port,
        connectedAt: vpnResult.running ? Date.now() : null,
        apiBase: normalizeApiBase(form.apiBase, form.host),
        apiToken: form.apiToken.trim() || PROXY_CONFIG.apiToken,
      }));
      void refreshStatus({ reason: 'manual', silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVpnError(message);
      appendVpnLog('VPN_ERROR', 'start_failed', { error: message }, true);
    } finally {
      setLoading(false);
    }
  }, [
    appendVpnLog,
    form.apiBase,
    form.apiToken,
    form.host,
    form.httpPort,
    form.password,
    form.socksPort,
    form.username,
    isNativePlatform,
    performWireGuardPreflight,
    refreshStatus,
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
  }, [appendVpnLog, isNativePlatform, vpnPluginAvailable]);

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
    setPinging(true);
    setDiagProgress('Проверяем HTTP/HTTPS');
    appendVpnLog('PING', 'diagnostic_request');
    try {
      const request: VpnDiagnosticRequest = {
        host: form.host || PROXY_CONFIG.host,
        port: Number(form.httpPort) || 8080,
        tests: ['http', 'https'],
        timeoutMs: 7000,
      };
      const diagnostic = await NativeVpn.diagnose(request);
      diagnostic.results.forEach((entry: VpnDiagnosticEntry) => {
        appendVpnLog('DIAG', 'result', {
          type: entry.type,
          success: entry.success,
          latencyMs: entry.latencyMs,
          message: entry.message ?? null,
        });
      });
      setDiagProgress('Диагностика завершена');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('DIAG_ERROR', 'diagnostic_failed', { error: message });
      setDiagProgress(`Ошибка диагностики: ${message}`);
    } finally {
      setPinging(false);
    }
  }, [appendVpnLog, form.host, form.httpPort]);

  const handleExportLog = useCallback(async () => {
    try {
      const fileName = `vpn-log-${Date.now()}.txt`;
      await Filesystem.writeFile({
        path: fileName,
        data: vpnLog.join('\n'),
        encoding: FilesystemEncoding.UTF8,
        directory: Directory.Documents,
      });
      appendVpnLog('LOG', 'exported', { fileName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendVpnLog('LOG_ERROR', 'export_failed', { error: message });
    }
  }, [appendVpnLog, vpnLog]);

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
      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
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
          {renderInput('HTTP порт', 'httpPort', 'text', '8080')}
          {renderInput('SOCKS порт', 'socksPort', 'text', '1080')}
          {renderInput('Логин (HTTP/SOCKS)', 'username')}
          {renderInput('Пароль (HTTP/SOCKS)', 'password', 'password', undefined, {
            autoComplete: 'current-password',
          })}
          {renderInput('API token', 'apiToken', 'text', 'e55757...', {
            autoComplete: 'off',
          })}
          {renderInput('API base (https://host:8787)', 'apiBase', 'text', 'https://host:8787')}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="primary" disabled={!canStart} onClick={handleEnableProxy}>
            {loading && !vpnRunning ? 'Проверяем конфиг...' : 'Включить VPN'}
          </Button>
          <Button variant="danger" disabled={!canStop} onClick={handleDisableProxy}>
            {loading && vpnRunning ? 'Отключаем...' : 'Выключить VPN'}
          </Button>
          <Button variant="neutral" disabled={!canRefresh} onClick={() => void refreshStatus({ reason: 'manual' })}>
            {refreshing ? 'Обновляем...' : 'Обновить статус'}
          </Button>
          <Button variant="neutral" disabled={pinging} onClick={handlePing}>
            {pinging ? 'Диагностика...' : 'Пинг / HTTPS тест'}
          </Button>
          <Button variant="neutral" onClick={() => void refreshExternalIp()}>
            Мой IP
          </Button>
          <Button variant="neutral" onClick={shareStatus}>
            Экспортировать статус
          </Button>
          <Button variant="neutral" onClick={handleExportLog}>
            Экспортировать лог
          </Button>
        </div>

        {warning && <p className="text-amber-400 text-sm">{warning}</p>}
        {vpnError && <p className="text-rose-400 text-sm">{vpnError}</p>}
        {diagProgress && <p className="text-slate-300 text-sm">{diagProgress}</p>}
      </section>

      <section className="rounded-3xl bg-slate-900/60 p-8 border border-slate-800 space-y-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-300">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Внешний IP</p>
            <p>{currentIp ?? 'нет данных'}</p>
            <p className="text-xs text-slate-400">
              Источник: {ipSourceLabel ?? 'н/д'}{' '}
              {ipError ? `Ошибка: ${ipError}` : ''}
            </p>
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

      <section className="rounded-3xl bg-slate-900/60 p-8 border border-slate-800 space-y-4">
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

      <section className="rounded-3xl bg-slate-900/60 p-8 border border-slate-800 space-y-4">
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
