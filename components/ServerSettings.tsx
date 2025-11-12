







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







import { NativeVpn, type VpnState } from '../native/nativeVpn';







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







}















interface ApiCallResult<T = unknown> {







  data: T | null;







  apiBase: string;







  tokenUsed: string;







}















const DEVICE_ID_STORAGE_KEY = 'vpn_device_id';







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







      const response = await CapacitorHttp.request({







        url,







        method: body ? 'POST' : 'GET',







        headers,







        data: body ? JSON.stringify(body) : undefined,







      });







      if ((response.status ?? 200) >= 400) {







        throw new Error(`API ${path} ответил ${response.status}`);







      }







      return {







        data: (response.data ?? null) as T | null,







        apiBase: url,







        tokenUsed: apiToken.trim(),







      };







    },







    [apiToken, normalizeApiBase]







  );















  const buildPreparedProfile = useCallback(







    (uri: string, parsed: ParsedVlessProfile): PreparedVlessProfile => {







      const configJson = buildVlessConfig(parsed, {







        inboundPort: DEFAULT_VLESS_INBOUND_PORT,







        outboundTag: 'proxy-out',







        inboundTag: 'socks-in',







      });







      return {







        profileUri: uri,







        parsed,







        configJson,







        outboundTag: 'proxy-out',







        label: parsed.remark || `${parsed.host}:${parsed.port}`,







      };







    },







    []







  );















  const applyProfile = useCallback(







    (profile: PreparedVlessProfile) => {







      setPreparedProfile(profile);







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







      const prepared = buildPreparedProfile(uri, parsed);







      applyProfile(prepared);







      appendLog('PROFILE_FETCHED', { endpoint: `${parsed.host}:${parsed.port}` });







    } catch (error) {







      const message = error instanceof Error ? error.message : String(error);







      setProfileError(message);







      appendLog('PROFILE_FETCH_ERROR', { error: message });







    }







  }, [applyProfile, appendLog, buildPreparedProfile, callServerApi, resolveDeviceId]);















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







const handleStartVpn = useCallback(async () => {







    if (!isNativePlatform) {

      setWarning('Доступно только на устройстве');

      return;

    }







    if (!preparedProfile) {







      setProfileError('Сначала импортируйте профиль');







      return;







    }







    setLoading(true);







    setWarning(null);







    try {







      const vpnResult = await NativeVpn.start({







        configJson: preparedProfile.configJson,







        outboundTag: preparedProfile.outboundTag,







        profileLabel: preparedProfile.label,







      });







      setVpnState(vpnResult);







      appendLog('VPN_START', { running: vpnResult.running });







      setRuntime({







        connected: vpnResult.running,







        host: preparedProfile.parsed.host,







        port: preparedProfile.parsed.port,







        lastMessage: vpnResult.running ? 'Туннель активен' : 'Не удалось запустить',







        updatedAt: Date.now(),







      });







      await refreshStatus();







    } catch (error) {







      const message = error instanceof Error ? error.message : String(error);







      setWarning(message);







      appendLog('VPN_START_ERROR', { error: message });







    } finally {







      setLoading(false);







    }







  }, [appendLog, preparedProfile, refreshStatus]);















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















  







};















export default ServerSettings;







