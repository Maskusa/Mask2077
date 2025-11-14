







import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';







import { Capacitor, CapacitorHttp } from '@capacitor/core';







import { Device } from '@capacitor/device';







import { Share } from '@capacitor/share';







import {







  Filesystem,







  Directory,







  Encoding as FilesystemEncoding,







} from '@capacitor/filesystem';







import jsQR from 'jsqr';







import Button from './Button';







import { PROXY_CONFIG } from '../constants/proxy';







import { NativeVpn, type NativeVpnLaunchOptions, type VpnState } from '../native/nativeVpn';







import {







  buildVlessConfig,







  parseVlessUri,







  extractVlessLinks,







  type ParsedVlessProfile,







  DEFAULT_VLESS_INBOUND_PORT,







} from '../constants/vless';















interface ServerSettingsProps {







  onBack: () => void;







  onShowLogs: () => void;







  addLog: (message: string) => void;







}















interface RuntimeState {







  connected: boolean;







  host: string | null;







  port: number | null;







  lastMessage: string;







  updatedAt: number | null;







}















interface PreparedVlessProfile {
  profileUri: string;
  parsed: ParsedVlessProfile;
  configJson: string;
  outboundTag: string;
  label: string;
  source: 'manual' | 'server';
  launchOptions: NativeVpnLaunchOptions;
}

interface StoredProfileSnapshot {
  profileUri: string;
  source?: 'manual' | 'server';
  launchOptions?: NativeVpnLaunchOptions;
}

const FALLBACK_SESSION_NAME = 'Mask2077 Tunnel';

const BASE_NATIVE_LAUNCH_OPTIONS: NativeVpnLaunchOptions = {
  socksHost: '127.0.0.1',
  socksPort: DEFAULT_VLESS_INBOUND_PORT,
  mtu: 8500,
  forwardUdp: true,
  dns: ['1.1.1.1', '8.8.8.8'],
  tunIpv4: { address: '198.18.0.1', prefix: 24, netmask: '255.255.255.0' },
  tunIpv6: { address: 'fc00::1', prefix: 128 },
  hev: {
    taskStackSize: 81920,
    udpInTcp: false,
    mapDnsEnabled: true,
    mapDnsAddress: '198.18.0.2',
    mapDnsPort: 53,
    mapDnsNetwork: '240.0.0.0',
    mapDnsNetmask: '240.0.0.0',
    mapDnsCacheSize: 10_000,
  },
};

const cloneLaunchOptions = (options: NativeVpnLaunchOptions): NativeVpnLaunchOptions => ({
  ...options,
  dns: options.dns ? [...options.dns] : undefined,
  tunIpv4: options.tunIpv4 ? { ...options.tunIpv4 } : undefined,
  tunIpv6: options.tunIpv6 ? { ...options.tunIpv6 } : undefined,
  hev: options.hev ? { ...options.hev } : undefined,
});

const createDefaultNativeLaunchOptions = (
  profile?: { label?: string; parsed?: ParsedVlessProfile | null }
): NativeVpnLaunchOptions => {
  const base = cloneLaunchOptions(BASE_NATIVE_LAUNCH_OPTIONS);
  const sessionName =
    profile?.label?.trim() ||
    profile?.parsed?.remark?.trim() ||
    FALLBACK_SESSION_NAME;
  return {
    ...base,
    sessionName,
  };
};

const parsePackageList = (raw: string): string[] => {
  if (!raw) {
    return [];
  }
  const unique = new Set<string>();
  raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => unique.add(entry));
  return Array.from(unique);
};

const formatPackageList = (entries?: string[]): string =>
  entries && entries.length > 0 ? entries.join('\n') : '';


type ServerProfileMismatch = Record<string, { local: unknown; remote: unknown }>;


















interface ApiCallResult<T = unknown> {







  data: T | null;







  apiBase: string;







  tokenUsed: string;







}















const DEVICE_ID_STORAGE_KEY = 'vpn_device_id';
const LOCAL_PROFILE_STORAGE_KEY = 'vpn_last_profile';







const MAX_LOG_LINES = 300;















const readFileAsText = (file: File): Promise<string> =>







  new Promise((resolve, reject) => {







    const reader = new FileReader();







    reader.onload = () => resolve((reader.result as string) ?? '');







    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));







    reader.readAsText(file);







  });















const decodeQrFile = async (file: File): Promise<string | null> => {







  const dataUrl = await new Promise<string>((resolve, reject) => {







    const reader = new FileReader();







    reader.onload = () => resolve((reader.result as string) ?? '');







    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать изображение'));







    reader.readAsDataURL(file);







  });







  return new Promise<string | null>((resolve, reject) => {







    const image = new Image();







    image.onload = () => {







      const canvas = document.createElement('canvas');







      canvas.width = image.width;







      canvas.height = image.height;







      const context = canvas.getContext('2d');







      if (!context) {







        reject(new Error('Canvas context недоступен'));







        return;







      }







      context.drawImage(image, 0, 0);







      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);







      const result = jsQR(imageData.data, imageData.width, imageData.height);







      resolve(result?.data ?? null);







    };







    image.onerror = () => reject(new Error('Не удалось загрузить изображение'));







    image.src = dataUrl;







  });







};















const formatTimestamp = (value: number | null) =>







  value ? new Date(value).toLocaleTimeString() : 'n/a';















const ServerSettings: React.FC<ServerSettingsProps> = ({ onBack, onShowLogs, addLog }) => {







  const [host, setHost] = useState(PROXY_CONFIG.host ?? '');







  const [apiBase, setApiBase] = useState('');







  const [apiToken, setApiToken] = useState(PROXY_CONFIG.apiToken ?? '');







  const [manualProfile, setManualProfile] = useState('');







  const [profileError, setProfileError] = useState<string | null>(null);







  const [preparedProfile, setPreparedProfile] = useState<PreparedVlessProfile | null>(null);
  const [nativeOptions, setNativeOptions] = useState<NativeVpnLaunchOptions>(() =>
    createDefaultNativeLaunchOptions()
  );
  const updateNativeOptions = useCallback(
    (updater: (prev: NativeVpnLaunchOptions) => NativeVpnLaunchOptions) => {
      setNativeOptions((prev) => {
        const next = updater(prev);
        setPreparedProfile((current) =>
          current ? { ...current, launchOptions: next } : current
        );
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined' || preparedProfile) {
      return;
    }
    const storage = window.localStorage;
    if (!storage) {
      return;
    }
    const raw = storage.getItem(LOCAL_PROFILE_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const snapshot: StoredProfileSnapshot = JSON.parse(raw);
      if (!snapshot || typeof snapshot.profileUri !== 'string' || !snapshot.profileUri.trim()) {
        return;
      }
      const parsed = parseVlessUri(snapshot.profileUri);
      const prepared = buildPreparedProfile(
        snapshot.profileUri,
        parsed,
        snapshot.source === 'server' ? 'server' : 'manual'
      );
      const launchOptions = snapshot.launchOptions
        ? cloneLaunchOptions(snapshot.launchOptions)
        : prepared.launchOptions;
      applyProfile({
        ...prepared,
        launchOptions,
      });
      appendLog('PROFILE_STORAGE_RESTORED', {
        source: snapshot.source ?? 'manual',
        label: prepared.label,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog('PROFILE_STORAGE_RESTORE_ERROR', { error: message });
      try {
        window.localStorage?.removeItem(LOCAL_PROFILE_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, [appendLog, applyProfile, buildPreparedProfile, preparedProfile]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storage = window.localStorage;
    if (!storage) {
      return;
    }
    if (!preparedProfile) {
      storage.removeItem(LOCAL_PROFILE_STORAGE_KEY);
      return;
    }
    const snapshot: StoredProfileSnapshot = {
      profileUri: preparedProfile.profileUri,
      source: preparedProfile.source,
      launchOptions: preparedProfile.launchOptions,
    };
    try {
      storage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog('PROFILE_STORAGE_SAVE_ERROR', { error: message });
    }
  }, [appendLog, preparedProfile]);







  const [profileInfo, setProfileInfo] = useState<ParsedVlessProfile | null>(null);







  const [vpnState, setVpnState] = useState<VpnState | null>(null);







  const [runtime, setRuntime] = useState<RuntimeState>({







    connected: false,







    host: null,







    port: null,







    lastMessage: 'Нет активных сессий',







    updatedAt: null,







  });







  const [logs, setLogs] = useState<string[]>([]);







  const [warning, setWarning] = useState<string | null>(null);







  const [loading, setLoading] = useState(false);







  const [statusSnapshot, setStatusSnapshot] = useState<Record<string, unknown> | null>(null);







  const [statusUpdatedAt, setStatusUpdatedAt] = useState<number | null>(null);







  const [deviceId, setDeviceId] = useState<string>('');







  const [serverLatency, setServerLatency] = useState<number | null>(null);







  const fileInputRef = useRef<HTMLInputElement | null>(null);







  const qrInputRef = useRef<HTMLInputElement | null>(null);







  const isNativePlatform = Capacitor.getPlatform() !== 'web';















  const appendLog = useCallback(







    (message: string, extra?: Record<string, unknown>) => {







      const line = `[${new Date().toISOString()}] ${message}${







        extra ? ` ${JSON.stringify(extra)}` : ''







      }`;







      setLogs((current) => {







        const next = [...current, line];







        if (next.length > MAX_LOG_LINES) {







          return next.slice(-MAX_LOG_LINES);







        }







        return next;







      });







      addLog(line);







    },







    [addLog]







  );


  const logTunnelStep = useCallback(
    (stage: string, extra?: Record<string, unknown>) => {
      appendLog(`VPN_FLOW:${stage}`, extra);
    },
    [appendLog]
  );


















  const resolveDeviceId = useCallback(async () => {







    if (deviceId) {







      return deviceId;







    }







    try {







      const storage = typeof window !== 'undefined' ? window.localStorage : null;







      const stored = storage?.getItem(DEVICE_ID_STORAGE_KEY);







      if (stored) {







        setDeviceId(stored);







        return stored;







      }







    } catch {







      // ignore storage errors







    }







    try {







      const nativeId = await Device.getId();







      if (nativeId.identifier) {







        setDeviceId(nativeId.identifier);







        try {







          window.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, nativeId.identifier);







        } catch {







          // ignore







        }







        return nativeId.identifier;







      }







    } catch (error) {







      appendLog('DEVICE_ID_ERROR', { error });







    }







    const fallback = `device-${Date.now()}`;







    setDeviceId(fallback);







    try {







      window.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, fallback);







    } catch {







      // ignore







    }







    return fallback;







  }, [appendLog, deviceId]);















  const normalizeApiBase = useCallback(() => {







    const trimmed = apiBase.trim();







    if (!trimmed) {







      return `https://${host.trim()}`;







    }







    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;







  }, [apiBase, host]);















  const callServerApi = useCallback(
    async <T,>(path: string, body?: Record<string, unknown>): Promise<ApiCallResult<T>> => {
      const url = `${normalizeApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
      const headers: Record<string, string> = {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'X-Auth-Token': apiToken.trim(),
      };
      const method = body ? 'POST' : 'GET';
      const started = Date.now();
      appendLog('API_REQUEST', { path, method, hasBody: Boolean(body) });
      try {
        const response = await CapacitorHttp.request({
          url,
          method,
          headers,
          data: body ? JSON.stringify(body) : undefined,
        });
        const latency = Date.now() - started;
        appendLog('API_RESPONSE', {
          path,
          status: response.status ?? 200,
          latency,
        });
        if ((response.status ?? 200) >= 400) {
          throw new Error(`API ${path} не ответил ${response.status}`);
        }
        return {
          data: (response.data ?? null) as T | null,
          apiBase: url,
          tokenUsed: apiToken.trim(),
        };
      } catch (error) {
        appendLog('API_REQUEST_ERROR', {
          path,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - started,
        });
        throw error;
      }
    },
    [apiToken, appendLog, normalizeApiBase]
  );


  const buildPreparedProfile = useCallback(





    (uri: string, parsed: ParsedVlessProfile, source: 'manual' | 'server' = 'manual'): PreparedVlessProfile => {







      const configJson = buildVlessConfig(parsed, {
        inboundPort: DEFAULT_VLESS_INBOUND_PORT,
        outboundTag: 'proxy-out',
        inboundTag: 'socks-in',
      });
      const label = parsed.remark || `${parsed.host}:${parsed.port}`;
      const launchOptions = createDefaultNativeLaunchOptions({ label, parsed });
      return {
        profileUri: uri,
        parsed,
        configJson,
        outboundTag: 'proxy-out',
        label,
        source,
        launchOptions,
      };







    },







    []







  );















  const applyProfile = useCallback(







    (profile: PreparedVlessProfile) => {







      setPreparedProfile(profile);
      setNativeOptions(profile.launchOptions ?? createDefaultNativeLaunchOptions(profile));







      setProfileInfo(profile.parsed);







      setManualProfile(profile.profileUri);







      setRuntime((prev) => ({







        ...prev,







        host: profile.parsed.host,







        port: profile.parsed.port,







        lastMessage: 'Профиль обновлён',







        updatedAt: Date.now(),







      }));







    },







    []







  );















  const handleManualProfileChange = useCallback((value: string) => {







    setManualProfile(value);







    setProfileError(null);







  }, []);















  const importProfileFromText = useCallback(







    (raw: string) => {







      const extracted = extractVlessLinks(raw).shift() ?? raw.trim();







      if (!extracted) {







        setProfileError('VLESS ссылка не найдена');







        return;







      }







      try {







        const parsed = parseVlessUri(extracted);







        const prepared = buildPreparedProfile(extracted, parsed);







        applyProfile(prepared);







        appendLog('PROFILE_IMPORTED', { source: 'manual' });







      } catch (error) {







        const message = error instanceof Error ? error.message : String(error);







        setProfileError(message);







      }







    },







    [applyProfile, appendLog, buildPreparedProfile]







  );















  const handlePasteFromClipboard = useCallback(async () => {







    try {







      const text = await navigator.clipboard.readText();







      importProfileFromText(text);







      handleManualProfileChange(text);







    } catch (error) {







      setProfileError('Буфер обмена недоступен');







    }







  }, [handleManualProfileChange, importProfileFromText]);















  const handleFileImport = useCallback(







    async (event: React.ChangeEvent<HTMLInputElement>) => {







      const file = event.target.files?.[0];







      event.target.value = '';







      if (!file) {







        return;







      }







      try {







        const text = await readFileAsText(file);







        importProfileFromText(text);







        handleManualProfileChange(text.trim());







      } catch (error) {







        setProfileError(error instanceof Error ? error.message : String(error));







      }







    },







    [handleManualProfileChange, importProfileFromText]







  );















  const handleQrImport = useCallback(







    async (event: React.ChangeEvent<HTMLInputElement>) => {







      const file = event.target.files?.[0];







      event.target.value = '';







      if (!file) {







        return;







      }







      try {







        const value = await decodeQrFile(file);







        if (!value) {







          setProfileError('QR не удалось распознать');







          return;







        }







        importProfileFromText(value);







        handleManualProfileChange(value.trim());







      } catch (error) {







        setProfileError(error instanceof Error ? error.message : String(error));







      }







    },







    [handleManualProfileChange, importProfileFromText]







  );















  const handleFetchServerProfile = useCallback(async () => {







    const device = await resolveDeviceId();







    setProfileError(null);







    try {







      const response = await callServerApi<{ profile?: string; vless?: string }>(







        '/vless/profile',







        {







          device_id: device,







        }







      );







      const body = response.data ?? {};







      const uri =







        typeof body.profile === 'string'







          ? body.profile







          : typeof body.vless === 'string'







          ? body.vless







          : null;







      if (!uri) {







        throw new Error('API не вернул VLESS профиль');







      }







      const parsed = parseVlessUri(uri);







      const prepared = buildPreparedProfile(uri, parsed, 'server');







      applyProfile(prepared);







      appendLog('PROFILE_FETCHED', { endpoint: `${parsed.host}:${parsed.port}` });







    } catch (error) {







      const message = error instanceof Error ? error.message : String(error);







      setProfileError(message);







      appendLog('PROFILE_FETCH_ERROR', { error: message });







    }







  }, [applyProfile, appendLog, buildPreparedProfile, callServerApi, resolveDeviceId]);















  const verifyServerProfile = useCallback(
    async (
      localProfile: PreparedVlessProfile
    ): Promise<{ ok: boolean; mismatches?: ServerProfileMismatch }> => {
      logTunnelStep('server_profile_check_started', {
        host: localProfile.parsed.host,
        port: localProfile.parsed.port,
      });
      try {
        const deviceIdValue = await resolveDeviceId();
        const response = await callServerApi<{ profile?: string; vless?: string }>(
          '/vless/profile',
          {
            device_id: deviceIdValue,
          }
        );
        const body = response.data ?? {};
        const remoteUri =
          typeof body.profile === 'string'
            ? body.profile
            : typeof body.vless === 'string'
            ? body.vless
            : null;
        if (!remoteUri) {
          appendLog('SERVER_PROFILE_ABSENT', { deviceId: deviceIdValue });
          logTunnelStep('server_profile_absent', { deviceId: deviceIdValue });
          return { ok: true };
        }
        const remoteParsed = parseVlessUri(remoteUri);
        const normalizeValue = (value: unknown) => {
          if (value === undefined || value === null) {
            return '';
          }
          if (Array.isArray(value)) {
            return value.join(',');
          }
          if (typeof value === 'string') {
            return value.trim();
          }
          return value;
        };
        const fields: ServerProfileMismatch = {
          id: { local: localProfile.parsed.id, remote: remoteParsed.id },
          host: { local: localProfile.parsed.host, remote: remoteParsed.host },
          port: { local: localProfile.parsed.port, remote: remoteParsed.port },
          security: { local: localProfile.parsed.security, remote: remoteParsed.security },
          network: { local: localProfile.parsed.network, remote: remoteParsed.network },
          sni: { local: localProfile.parsed.sni ?? '', remote: remoteParsed.sni ?? '' },
          fingerprint: { local: localProfile.parsed.fingerprint ?? '', remote: remoteParsed.fingerprint ?? '' },
          publicKey: { local: localProfile.parsed.publicKey ?? '', remote: remoteParsed.publicKey ?? '' },
          shortId: { local: localProfile.parsed.shortId ?? '', remote: remoteParsed.shortId ?? '' },
          flow: { local: localProfile.parsed.flow ?? '', remote: remoteParsed.flow ?? '' },
          path: { local: localProfile.parsed.path ?? '', remote: remoteParsed.path ?? '' },
        };
        const mismatches = Object.entries(fields).filter(
          ([, values]) => normalizeValue(values.local) !== normalizeValue(values.remote)
        );
        if (mismatches.length === 0) {
          appendLog('SERVER_PROFILE_VERIFIED', {
            host: remoteParsed.host,
            port: remoteParsed.port,
            security: remoteParsed.security,
          });
          logTunnelStep('server_profile_verified', {
            host: remoteParsed.host,
            port: remoteParsed.port,
            security: remoteParsed.security,
          });
          return { ok: true };
        }
        const mismatchPayload = mismatches.reduce<ServerProfileMismatch>((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});
        appendLog('SERVER_PROFILE_MISMATCH', mismatchPayload);
        logTunnelStep('server_profile_mismatch', { fields: Object.keys(mismatchPayload) });
        return { ok: false, mismatches: mismatchPayload };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog('SERVER_PROFILE_CHECK_ERROR', { error: message });
        logTunnelStep('server_profile_check_error', { error: message });
        return { ok: true };
      }
    },
    [appendLog, callServerApi, logTunnelStep, resolveDeviceId]
  );


  const handlePrepareFromManual = useCallback(() => {







    if (!manualProfile.trim()) {







      setProfileError('Вставьте ссылку vless://');







      return;







    }







    importProfileFromText(manualProfile);







  }, [importProfileFromText, manualProfile]);















  const refreshStatus = useCallback(async () => {







    try {







      const started = Date.now();







      const response = await callServerApi<Record<string, unknown>>('/proxy/status');







      setStatusSnapshot(response.data ?? null);







      setStatusUpdatedAt(Date.now());







      setServerLatency(Date.now() - started);







      appendLog('STATUS_REFRESH', { latency: Date.now() - started });







    } catch (error) {







      appendLog('STATUS_REFRESH_ERROR', {







        error: error instanceof Error ? error.message : String(error),







      });







    }







  }, [appendLog, callServerApi]);















  useEffect(() => {







    refreshStatus().catch(() => undefined);







  }, [refreshStatus]);















  useEffect(() => {







    resolveDeviceId().catch(() => undefined);







  }, [resolveDeviceId]);















  const shareLogs = useCallback(async () => {







    try {







      const fileName = `vless-log-${Date.now()}.txt`;







      await Filesystem.writeFile({







        path: fileName,







        data: logs.join('\n'),







        encoding: FilesystemEncoding.UTF8,







        directory: Directory.Cache,







      });







      const uri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });







      await Share.share({







        title: 'VLESS лог',







        text: 'Отладочный журнал',







        url: uri.uri,







      });







    } catch (error) {







      appendLog('LOG_SHARE_ERROR', { error });







    }







  }, [appendLog, logs]);















  const profileSummary = useMemo(() => {







    if (!profileInfo) {







      return null;







    }







    return [







      { label: 'UUID', value: profileInfo.id },







      { label: 'Сервер', value: `${profileInfo.host}:${profileInfo.port}` },







      { label: 'Безопасность', value: profileInfo.security.toUpperCase() },







      { label: 'Транспорт', value: profileInfo.network.toUpperCase() },







      { label: 'SNI', value: profileInfo.sni ?? 'n/a' },







    ];







  }, [profileInfo]);















  const handleNativeOptionsReset = useCallback(() => {
    updateNativeOptions(() =>
      createDefaultNativeLaunchOptions(preparedProfile ?? undefined)
    );
  }, [preparedProfile, updateNativeOptions]);

  const handleStartVpn = useCallback(async () => {
    logTunnelStep('button_pressed', {
      hasProfile: Boolean(preparedProfile),
      platform: Capacitor.getPlatform(),
    });
    if (!isNativePlatform) {
      logTunnelStep('blocked_non_native');
      setWarning('Доступно только на устройстве');
      return;
    }
    if (!preparedProfile) {
      logTunnelStep('blocked_no_profile');
      setProfileError('Сначала импортируйте профиль');
      return;
    }
      logTunnelStep('validation_passed', {
        label: preparedProfile.label,
        endpoint: `${preparedProfile.parsed.host}:${preparedProfile.parsed.port}`,
      });
    logTunnelStep('preflight_passed', {
      outboundTag: preparedProfile.outboundTag,
      inboundPort: DEFAULT_VLESS_INBOUND_PORT,
      profileLabel: preparedProfile.label,
    });
    if (preparedProfile.source === 'server') {
      const serverProfileCheck = await verifyServerProfile(preparedProfile);
      if (serverProfileCheck && serverProfileCheck.ok === false) {
        const mismatchMessage = 'Профиль на сервере изменился — обновите данные перед запуском.';
        setWarning(mismatchMessage);
        setProfileError(mismatchMessage);
        appendLog('VPN_START_ABORTED', {
          reason: 'server_mismatch',
          mismatches: serverProfileCheck.mismatches ?? null,
        });
        logTunnelStep('blocked_server_mismatch', {
          fields: Object.keys(serverProfileCheck.mismatches ?? {}),
        });
        return;
      }
    } else {
      logTunnelStep('server_profile_check_skipped', { reason: preparedProfile.source });
    }
    setLoading(true);
    logTunnelStep('loading_flag_set');
    setWarning(null);
    try {
      logTunnelStep('native_start_request', {
        outboundTag: preparedProfile.outboundTag,
        inboundPort: DEFAULT_VLESS_INBOUND_PORT,
        profileLabel: preparedProfile.label,
      });
      const launchOptions =
        preparedProfile.launchOptions ?? nativeOptions;
      const vpnResult = await NativeVpn.start({
        configJson: preparedProfile.configJson,
        outboundTag: preparedProfile.outboundTag,
        profileLabel: preparedProfile.label,
        launchOptions,
      });
      logTunnelStep('native_start_response', {
        running: vpnResult.running,
        exitCode: vpnResult.exitCode ?? null,
      });
      setVpnState(vpnResult);
      logTunnelStep('native_state_committed', {
        running: vpnResult.running,
        exitCode: vpnResult.exitCode ?? null,
      });
      appendLog('VPN_START', { running: vpnResult.running });
      setRuntime({
        connected: vpnResult.running,
        host: preparedProfile.parsed.host,
        port: preparedProfile.parsed.port,
        lastMessage: vpnResult.running ? 'Туннель активен' : 'Не удалось запустить',
        updatedAt: Date.now(),
      });
      logTunnelStep('runtime_updated', {
        connected: vpnResult.running,
        host: preparedProfile.parsed.host,
        port: preparedProfile.parsed.port,
      });
      logTunnelStep('status_refresh_started');
      await refreshStatus();
      logTunnelStep('status_refresh_completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWarning(message);
      appendLog('VPN_START_ERROR', { error: message });
      logTunnelStep('native_start_error', { error: message });
    } finally {
      setLoading(false);
      logTunnelStep('loading_flag_cleared');
      logTunnelStep('flow_finished');
    }
  }, [
    appendLog,
    logTunnelStep,
    nativeOptions,
    preparedProfile,
    refreshStatus,
    verifyServerProfile,
  ]);


  const handleStopVpn = useCallback(async () => {

    if (!isNativePlatform) {

      setWarning('Доступно только на устройстве');

      return;

    }







    setLoading(true);







    try {







      const state = await NativeVpn.stop();







      setVpnState(state);







      appendLog('VPN_STOP', { running: state.running });







      setRuntime((prev) => ({







        ...prev,







        connected: false,







        lastMessage: 'Туннель остановлен',







        updatedAt: Date.now(),







      }));







    } catch (error) {







      const message = error instanceof Error ? error.message : String(error);







      appendLog('VPN_STOP_ERROR', { error: message });







    } finally {







      setLoading(false);







    }







  }, [appendLog]);

  return (







    <div className="space-y-6">







      <section className="rounded-3xl bg-slate-900/70 border border-emerald-500/30 p-6 space-y-4">







        <div className="flex items-center justify-between gap-3 flex-wrap">







          <div>







            <h2 className="text-xl font-semibold text-white">VLESS сервер</h2>







            <p className="text-sm text-slate-400">







              Управление API, импорт профиля и запуск туннеля через libv2ray.







            </p>







          </div>







          <div className="flex gap-3 flex-wrap">







            <Button variant="neutral" onClick={onBack}>







              Назад







            </Button>







            <Button variant="neutral" onClick={onShowLogs}>







              Архив логов







            </Button>







          </div>







        </div>















        {warning && (







          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-100">







            {warning}







          </div>







        )}















        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">







          <label className="space-y-1 text-sm text-slate-300">







            <span>API Host</span>







            <input







              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"







              value={host}







              onChange={(event) => setHost(event.target.value)}







              placeholder="45.151.183.153"







            />







          </label>







          <label className="space-y-1 text-sm text-slate-300">







            <span>API Token</span>







            <input







              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"







              value={apiToken}







              onChange={(event) => setApiToken(event.target.value)}







              placeholder="e55757..."







              autoComplete="off"







            />







          </label>







          <label className="space-y-1 text-sm text-slate-300">







            <span>API Base URL</span>







            <input







              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"







              value={apiBase}







              onChange={(event) => setApiBase(event.target.value)}







              placeholder="https://host"







            />







          </label>







          <div className="space-y-2">







            <span className="block text-sm text-slate-300">Управление профилем</span>







            <div className="flex flex-wrap gap-2">







              <Button variant="secondary" onClick={handleFetchServerProfile} disabled={loading}>







                Запросить с сервера







              </Button>







              <Button variant="secondary" onClick={handlePasteFromClipboard}>







                Вставить из буфера







              </Button>







              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>







                Файл







              </Button>







              <Button variant="secondary" onClick={() => qrInputRef.current?.click()}>







                QR / Фото







              </Button>







            </div>







            <div className="text-xs text-slate-400">







              Можно вставить ссылку вида <code>vless://</code>, загрузить текстовый файл или распознать QR.







            </div>







          </div>







        </div>















        <textarea







          className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-3 text-sm text-white outline-none"







          rows={4}







          value={manualProfile}







          onChange={(event) => handleManualProfileChange(event.target.value)}







          placeholder="vless://uuid@host:443?security=tls&type=ws#Mask"







        />







        {profileError && <p className="text-sm text-rose-400">{profileError}</p>}







        <div className="flex gap-3 flex-wrap">







          <Button variant="primary" onClick={handlePrepareFromManual} disabled={loading}>







            Применить текст профиля







          </Button>







        </div>







        <input







          ref={fileInputRef}







          type="file"







          accept=".txt,.json"







          className="hidden"







          onChange={handleFileImport}







        />







        <input ref={qrInputRef} type="file" accept="image/*" className="hidden" onChange={handleQrImport} />







      </section>















      <section className="rounded-3xl bg-slate-900/70 border border-slate-700 p-6 space-y-4">







        <div className="flex items-center justify-between">







          <h3 className="text-lg font-semibold text-white">Профиль VLESS</h3>







          <span className="text-xs text-slate-400">







            Порт туннеля: {preparedProfile?.parsed.port ?? 'n/a'} (fake inbound {DEFAULT_VLESS_INBOUND_PORT})







          </span>







        </div>







        {profileSummary ? (







          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-200">







            {profileSummary.map((field) => (







              <div key={field.label} className="rounded-2xl border border-slate-700 px-4 py-3">







                <dt className="text-xs uppercase tracking-wide text-slate-400">{field.label}</dt>







                <dd className="font-mono text-base">{field.value || 'n/a'}</dd>







              </div>







            ))}







          </dl>







        ) : (







          <p className="text-sm text-slate-400">Профиль пока не загружен.</p>







        )}







      </section>















      <section className="rounded-3xl bg-slate-900/70 border border-slate-700 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-white">Tunnel Settings</h3>
            <p className="text-sm text-slate-400">
              Override MTU, DNS and hev-socks5-tunnel parameters before launching the VPN.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="neutral" onClick={handleNativeOptionsReset}>
              Reset to defaults
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Session name</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.sessionName ??
                preparedProfile?.label ??
                preparedProfile?.parsed.remark ??
                FALLBACK_SESSION_NAME
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  sessionName: event.target.value.length ? event.target.value : undefined,
                }))
              }
              placeholder="Mask2077 Tunnel"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">MTU</span>
            <input
              type="number"
              min={576}
              max={9000}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={nativeOptions.mtu ?? BASE_NATIVE_LAUNCH_OPTIONS.mtu ?? ''}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                updateNativeOptions((prev) => ({
                  ...prev,
                  mtu: Number.isFinite(next) ? next : undefined,
                }));
              }}
              placeholder="8500"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">DNS (comma separated)</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.dns && nativeOptions.dns.length > 0
                  ? nativeOptions.dns.join(', ')
                  : (BASE_NATIVE_LAUNCH_OPTIONS.dns ?? []).join(', ')
              }
              onChange={(event) => {
                const entries = event.target.value
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean);
                updateNativeOptions((prev) => ({
                  ...prev,
                  dns: entries.length ? entries : undefined,
                }));
              }}
              placeholder="1.1.1.1, 8.8.8.8"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">IPv4 address</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.tunIpv4?.address ??
                BASE_NATIVE_LAUNCH_OPTIONS.tunIpv4?.address ??
                ''
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  tunIpv4: {
                    ...(prev.tunIpv4 ?? {}),
                    address: event.target.value || undefined,
                  },
                }))
              }
              placeholder="198.18.0.1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-wide text-slate-400">IPv4 prefix</span>
              <input
                type="number"
                min={1}
                max={32}
                className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
                value={
                  nativeOptions.tunIpv4?.prefix ??
                  BASE_NATIVE_LAUNCH_OPTIONS.tunIpv4?.prefix ??
                  ''
                }
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  updateNativeOptions((prev) => ({
                    ...prev,
                    tunIpv4: {
                      ...(prev.tunIpv4 ?? {}),
                      prefix: Number.isFinite(next) ? next : undefined,
                    },
                  }));
                }}
                placeholder="24"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-wide text-slate-400">IPv4 netmask</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.tunIpv4?.netmask ??
                BASE_NATIVE_LAUNCH_OPTIONS.tunIpv4?.netmask ??
                ''
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  tunIpv4: {
                    ...(prev.tunIpv4 ?? {}),
                    netmask: event.target.value || undefined,
                  },
                }))
              }
              placeholder="255.255.255.0"
            />
            </label>
          </div>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">IPv6 address</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.tunIpv6?.address ??
                BASE_NATIVE_LAUNCH_OPTIONS.tunIpv6?.address ??
                ''
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  tunIpv6: {
                    ...(prev.tunIpv6 ?? {}),
                    address: event.target.value || undefined,
                  },
                }))
              }
              placeholder="fc00::1"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">IPv6 prefix</span>
            <input
              type="number"
              min={1}
              max={128}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.tunIpv6?.prefix ??
                BASE_NATIVE_LAUNCH_OPTIONS.tunIpv6?.prefix ??
                ''
              }
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                updateNativeOptions((prev) => ({
                  ...prev,
                  tunIpv6: {
                    ...(prev.tunIpv6 ?? {}),
                    prefix: Number.isFinite(next) ? next : undefined,
                  },
                }));
              }}
              placeholder="128"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Map DNS address</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.hev?.mapDnsAddress ??
                BASE_NATIVE_LAUNCH_OPTIONS.hev?.mapDnsAddress ??
                ''
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  hev: {
                    ...(prev.hev ?? {}),
                    mapDnsAddress: event.target.value || undefined,
                  },
                }))
              }
              placeholder="198.18.0.2"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Map DNS port</span>
            <input
              type="number"
              min={1}
              max={65535}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.hev?.mapDnsPort ??
                BASE_NATIVE_LAUNCH_OPTIONS.hev?.mapDnsPort ??
                ''
              }
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                updateNativeOptions((prev) => ({
                  ...prev,
                  hev: {
                    ...(prev.hev ?? {}),
                    mapDnsPort: Number.isFinite(next) ? next : undefined,
                  },
                }));
              }}
              placeholder="53"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Map DNS network</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.hev?.mapDnsNetwork ??
                BASE_NATIVE_LAUNCH_OPTIONS.hev?.mapDnsNetwork ??
                ''
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  hev: {
                    ...(prev.hev ?? {}),
                    mapDnsNetwork: event.target.value || undefined,
                  },
                }))
              }
              placeholder="240.0.0.0"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Map DNS netmask</span>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={
                nativeOptions.hev?.mapDnsNetmask ??
                BASE_NATIVE_LAUNCH_OPTIONS.hev?.mapDnsNetmask ??
                ''
              }
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  hev: {
                    ...(prev.hev ?? {}),
                    mapDnsNetmask: event.target.value || undefined,
                  },
                }))
              }
              placeholder="240.0.0.0"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Allowed packages
              </span>
              <span className="text-[11px] uppercase text-slate-500">one per line</span>
            </div>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={formatPackageList(nativeOptions.allowedApps)}
              onChange={(event) => {
                const entries = parsePackageList(event.target.value);
                updateNativeOptions((prev) => ({
                  ...prev,
                  allowedApps: entries.length ? entries : undefined,
                }));
              }}
              placeholder="com.android.chrome&#10;org.telegram.messenger"
            />
            <p className="text-xs text-slate-500">
              Если список не пустой, VPN будет активен только для указанных приложений. Остальные
              пакеты будут исключены автоматически.
            </p>
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Blocked packages
              </span>
              <span className="text-[11px] uppercase text-slate-500">one per line</span>
            </div>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-white outline-none"
              value={formatPackageList(nativeOptions.disallowedApps)}
              onChange={(event) => {
                const entries = parsePackageList(event.target.value);
                updateNativeOptions((prev) => ({
                  ...prev,
                  disallowedApps: entries.length ? entries : undefined,
                }));
              }}
              placeholder="com.miui.home&#10;com.google.android.gms"
            />
            <p className="text-xs text-slate-500">
              При пустом списке ограничения не применяются. Если разрешённый список задан, то
              запреты игнорируются и используются только разрешения.
            </p>
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-slate-200">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-emerald-400"
              checked={nativeOptions.forwardUdp ?? true}
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  forwardUdp: event.target.checked,
                }))
              }
            />
            <span>Forward UDP traffic</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-emerald-400"
              checked={nativeOptions.hev?.udpInTcp ?? false}
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  hev: {
                    ...(prev.hev ?? {}),
                    udpInTcp: event.target.checked,
                  },
                }))
              }
            />
            <span>Force UDP-in-TCP</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-emerald-400"
              checked={nativeOptions.hev?.mapDnsEnabled ?? true}
              onChange={(event) =>
                updateNativeOptions((prev) => ({
                  ...prev,
                  hev: {
                    ...(prev.hev ?? {}),
                    mapDnsEnabled: event.target.checked,
                  },
                }))
              }
            />
            <span>Capture DNS via hev</span>
          </label>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-900/70 border border-slate-700 p-6 space-y-4">







        <div className="flex items-center justify-between gap-3 flex-wrap">







          <div>







            <h3 className="text-lg font-semibold text-white">Туннель</h3>







            <p className="text-sm text-slate-400">







              Управление libv2ray и просмотр состояния NativeVpn.







            </p>







          </div>







          <div className="flex gap-2 flex-wrap">







            <Button variant="primary" onClick={handleStartVpn} disabled={loading || !preparedProfile}>







              Запустить







            </Button>







            <Button variant="neutral" onClick={handleStopVpn} disabled={loading}>







              Остановить







            </Button>







            <Button variant="secondary" onClick={refreshStatus}>







              Обновить статус







            </Button>







          </div>







        </div>















        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-200">







          <div className="rounded-2xl border border-slate-700 px-4 py-3">







            <div className="text-xs uppercase text-slate-400">Состояние</div>







            <div className="text-base font-semibold">







              {runtime.connected ? 'Активен' : 'Не запущен'}







            </div>







            <div className="text-xs text-slate-500">







              {runtime.host ? `${runtime.host}:${runtime.port}` : 'профиль не выбран'}







            </div>







          </div>







          <div className="rounded-2xl border border-slate-700 px-4 py-3">







            <div className="text-xs uppercase text-slate-400">Последнее событие</div>







            <div className="text-base font-semibold">{runtime.lastMessage}</div>







            <div className="text-xs text-slate-500">{formatTimestamp(runtime.updatedAt)}</div>







          </div>







          <div className="rounded-2xl border border-slate-700 px-4 py-3">







            <div className="text-xs uppercase text-slate-400">NativeVpn</div>







            <div className="text-base font-semibold">{vpnState?.running ? 'работает' : 'остановлен'}</div>







            <div className="text-xs text-slate-500">exitCode: {vpnState?.exitCode ?? 'n/a'}</div>







          </div>







          <div className="rounded-2xl border border-slate-700 px-4 py-3">







            <div className="text-xs uppercase text-slate-400">API статус</div>







            <div className="text-base font-semibold">{serverLatency ?? '—'} мс</div>







            <div className="text-xs text-slate-500">{formatTimestamp(statusUpdatedAt)}</div>







          </div>







        </div>







      </section>















      <section className="rounded-3xl bg-slate-900/70 border border-slate-700 p-6 space-y-4">







        <div className="flex items-center justify-between gap-3 flex-wrap">







          <h3 className="text-lg font-semibold text-white">Логи</h3>







          <div className="flex gap-2">







            <Button variant="secondary" onClick={shareLogs}>







              Поделиться







            </Button>







            <Button variant="secondary" onClick={() => setLogs([])}>







              Очистить







            </Button>







          </div>







        </div>







        <div className="max-h-72 overflow-auto rounded-2xl border border-slate-800 bg-black/40 p-3 text-xs font-mono text-emerald-200">







          {logs.length === 0 ? 'Пока пусто' : logs.map((line) => <div key={line}>{line}</div>)}







        </div>







        {statusSnapshot && (







          <div className="text-xs text-slate-400">







            /proxy/status → <code>{JSON.stringify(statusSnapshot).slice(0, 200)}</code>







          </div>







        )}







      </section>







    </div>







  );






















  







};















export default ServerSettings;






