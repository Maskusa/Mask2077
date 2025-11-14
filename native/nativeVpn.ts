import { registerPlugin } from '@capacitor/core';

export interface NativeVpnTunAddress {
  address: string;
  prefix: number;
  netmask?: string;
}

export interface NativeVpnHevOptions {
  taskStackSize?: number;
  udpInTcp?: boolean;
  socksUdpAddress?: string;
  mapDnsEnabled?: boolean;
  mapDnsAddress?: string;
  mapDnsPort?: number;
  mapDnsNetwork?: string;
  mapDnsNetmask?: string;
  mapDnsCacheSize?: number;
}

export interface NativeVpnLaunchOptions {
  sessionName?: string;
  socksHost?: string;
  socksPort?: number;
  socksUsername?: string;
  socksPassword?: string;
  mtu?: number;
  forwardUdp?: boolean;
  dns?: string[];
  allowedApps?: string[];
  disallowedApps?: string[];
  tunIpv4?: NativeVpnTunAddress;
  tunIpv6?: NativeVpnTunAddress;
  hev?: NativeVpnHevOptions;
}

export interface VpnStartOptions {
  configJson: string;
  outboundTag?: string;
  profileLabel?: string;
  launchOptions?: NativeVpnLaunchOptions;
}

export interface VpnState {
  running: boolean;
  exitCode?: number;
  error?: string;
  requestedStart?: boolean;
  stats?: VpnStats;
}

export interface VpnPermissionResult {
  granted: boolean;
}

export interface VpnStats {
  txPackets: number;
  txBytes: number;
  rxPackets: number;
  rxBytes: number;
  startedAt: number;
  uptimeMs: number;
  exitCode: number;
  nativeRunning: boolean;
  restartAttempts: number;
  lastRestartAt: number;
  lastRestartReason?: string | null;
}

export type VpnDiagnosticType = 'ping' | 'dns' | 'tcp' | 'udp' | 'http' | 'https';

export interface VpnDiagnosticRequest {
  host?: string;
  port?: number;
  url?: string;
  timeoutMs?: number;
  tests?: VpnDiagnosticType[];
}

export interface VpnDiagnosticEntry {
  type: VpnDiagnosticType | string;
  success: boolean;
  latencyMs: number;
  status?: number;
  message?: string | null;
  timestamp: number;
}

export interface VpnDiagnosticResult {
  startedAt: number;
  finishedAt: number;
  results: VpnDiagnosticEntry[];
}

export interface ApiRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ApiResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  url: string;
}

export interface NativeVpnPlugin {
  checkPermission(): Promise<VpnPermissionResult>;
  requestPermission(): Promise<VpnPermissionResult>;
  start(options: VpnStartOptions): Promise<VpnState>;
  stop(): Promise<VpnState>;
  getState(): Promise<VpnState>;
  diagnose(options: VpnDiagnosticRequest): Promise<VpnDiagnosticResult>;
  apiRequest(options: ApiRequestOptions): Promise<ApiResponse>;
  setDebugMode?(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  getDeviceFingerprint?(): Promise<{ fingerprint: string; source?: string }>;
}

export const NativeVpn = registerPlugin<NativeVpnPlugin>('NativeVpn');
