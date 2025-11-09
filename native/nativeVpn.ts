import { registerPlugin } from '@capacitor/core';

export interface VpnStartOptions {
  host: string;
  httpPort: number;
  socksPort: number;
  username: string;
  password: string;
  mode: 'HTTP' | 'SOCKS5';
  enableUdp?: boolean;
  debugMode?: boolean;
  wireguardConfigBase64?: string;
}

export interface VpnState {
  running: boolean;
  exitCode?: number;
  error?: string;
  requestedStart?: boolean;
  config?: {
    host: string;
    httpPort: number;
    socksPort: number;
    username: string;
    udp: boolean;
  };
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

export type VpnDiagnosticType = 'ping' | 'dns' | 'tcp' | 'http' | 'https';

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
