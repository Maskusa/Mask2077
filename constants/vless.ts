export type VlessNetwork = 'tcp' | 'ws' | 'grpc';
export type VlessSecurity = 'tls' | 'reality' | 'none';

export interface ParsedVlessProfile {
  uri: string;
  remark: string;
  id: string;
  host: string;
  port: number;
  encryption: string;
  flow?: string;
  security: VlessSecurity;
  network: VlessNetwork;
  sni?: string;
  alpn?: string[];
  fingerprint?: string;
  publicKey?: string;
  shortId?: string;
  serviceName?: string;
  path?: string;
  headers?: Record<string, string>;
}

export interface BuildVlessConfigOptions {
  inboundPort?: number;
  inboundTag?: string;
  outboundTag?: string;
  dnsServers?: string[];
  logLevel?: 'debug' | 'info' | 'warning' | 'error' | 'none';
}

export const DEFAULT_VLESS_DNS = ['https://dns.google/dns-query', '1.1.1.1'];
export const DEFAULT_VLESS_INBOUND_PORT = 10808;
const DEFAULT_INBOUND_TAG = 'socks-in';
const DEFAULT_OUTBOUND_TAG = 'proxy-out';
const DEFAULT_DNS = DEFAULT_VLESS_DNS;

const normalizeRemark = (value?: string | null) => (value ? decodeURIComponent(value.trim()) : '');

export const extractVlessLinks = (text: string): string[] => {
  if (!text) {
    return [];
  }
  const matches = text.match(/vless:\/\/[^\s"'<>]+/gi);
  if (!matches) {
    return [];
  }
  return matches.map((entry) => entry.trim());
};

export const parseVlessUri = (input: string): ParsedVlessProfile => {
  if (!input || !input.trim()) {
    throw new Error('VLESS ссылка пуста');
  }
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith('vless://')) {
    throw new Error('Ожидалась ссылка вида vless://');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error('Некорректный формат VLESS ссылки');
  }
  const id = parsed.username ? decodeURIComponent(parsed.username) : '';
  if (!id) {
    throw new Error('UUID в ссылке отсутствует');
  }
  const host = parsed.hostname;
  if (!host) {
    throw new Error('Хост в профиле не найден');
  }
  const port = parsed.port ? Number.parseInt(parsed.port, 10) || 443 : 443;
  const remark = parsed.hash ? normalizeRemark(parsed.hash.slice(1)) : '';
  const params = parsed.searchParams;
  const security = (params.get('security') || 'tls').toLowerCase() as VlessSecurity;
  const network = (params.get('type') || 'tcp').toLowerCase() as VlessNetwork;
  const encryption = params.get('encryption') || 'none';
  const flow = params.get('flow') || undefined;
  const sni = params.get('sni') || params.get('host') || undefined;
  const fingerprint = params.get('fp') || undefined;
  const publicKey = params.get('pbk') || params.get('publicKey') || undefined;
  const shortId = params.get('sid') || params.get('shortId') || undefined;
  const path = params.get('path') || undefined;
  const serviceName = params.get('serviceName') || undefined;
  const alpnRaw = params.get('alpn');
  const alpn =
    alpnRaw && alpnRaw.length > 0
      ? alpnRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined;
  const headers: Record<string, string> = {};
  if (params.get('host')) {
    headers.Host = params.get('host') as string;
  }
  return {
    uri: trimmed,
    remark,
    id,
    host,
    port,
    encryption,
    flow: flow || undefined,
    security: security === 'reality' ? 'reality' : security === 'none' ? 'none' : 'tls',
    network: network === 'grpc' ? 'grpc' : network === 'ws' ? 'ws' : 'tcp',
    sni: sni || undefined,
    alpn,
    fingerprint: fingerprint || undefined,
    publicKey: publicKey || undefined,
    shortId: shortId || undefined,
    serviceName: serviceName || undefined,
    path: path || undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
};

export const buildVlessConfig = (
  profile: ParsedVlessProfile,
  options: BuildVlessConfigOptions = {}
): string => {
  const inboundPort = options.inboundPort ?? DEFAULT_INBOUND_PORT;
  const inboundTag = options.inboundTag ?? DEFAULT_INBOUND_TAG;
  const outboundTag = options.outboundTag ?? DEFAULT_OUTBOUND_TAG;
  const dnsServers = options.dnsServers ?? DEFAULT_DNS;
  const logLevel = options.logLevel ?? 'warning';

  const config = {
    log: {
      loglevel: logLevel,
    },
    dns: {
      servers: dnsServers,
    },
    inbounds: [
      {
        tag: inboundTag,
        listen: '127.0.0.1',
        port: inboundPort,
        protocol: 'socks',
        settings: {
          auth: 'noauth',
          udp: true,
        },
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
        },
      },
    ],
    outbounds: [
      {
        tag: outboundTag,
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: profile.host,
              port: profile.port,
              users: [
                {
                  id: profile.id,
                  encryption: profile.encryption || 'none',
                  flow: profile.flow,
                  level: 0,
                },
              ],
            },
          ],
        },
        streamSettings: buildStreamSettings(profile),
        mux: {
          enabled: false,
        },
      },
      {
        tag: 'direct',
        protocol: 'freedom',
        settings: {},
      },
      {
        tag: 'block',
        protocol: 'blackhole',
        settings: {
          response: {
            type: 'http',
          },
        },
      },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          inboundTag: [inboundTag],
          outboundTag,
        },
      ],
    },
    stats: {},
    policy: {
      levels: {
        '0': {
          handshake: 4,
          connIdle: 300,
        },
      },
      system: {
        statsOutboundDownlink: true,
        statsOutboundUplink: true,
      },
    },
  };

  return JSON.stringify(config, null, 2);
};

const buildStreamSettings = (profile: ParsedVlessProfile) => {
  const base: Record<string, unknown> = {
    network: profile.network,
    security: profile.security === 'none' ? 'none' : profile.security,
  };

  if (profile.security === 'tls') {
    base.tlsSettings = {
      serverName: profile.sni || profile.host,
      allowInsecure: false,
      fingerprint: profile.fingerprint,
      alpn: profile.alpn,
    };
  } else if (profile.security === 'reality') {
    base.realitySettings = {
      fingerprint: profile.fingerprint || 'chrome',
      serverName: profile.sni || profile.host,
      publicKey: profile.publicKey,
      shortId: profile.shortId,
      spiderX: profile.path || '',
    };
  }

  if (profile.network === 'ws') {
    base.wsSettings = {
      path: profile.path || '/',
      headers: profile.headers || {},
    };
  } else if (profile.network === 'grpc') {
    base.grpcSettings = {
      serviceName: profile.serviceName || 'grpc',
      multiMode: true,
    };
  } else if (profile.path) {
    base.tcpSettings = {
      header: {
        type: 'http',
        request: {
          path: [profile.path],
          headers: {
            Host: [profile.headers?.Host || profile.host],
            'User-Agent': ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
          },
        },
      },
    };
  }

  return base;
};
