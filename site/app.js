const DEFAULT_TEXT = 'Privet! Eto test sinteza rechi.';
const RATE_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 1.75, label: '1.75x' },
  { value: 2, label: '2x' },
];
const YOUTUBE_EMBED_BASE_URL = 'https://www.youtube.com/embed/';
const YOUTUBE_MOBILE_URL = 'https://m.youtube.com/';
const LOG_LIMIT = 240;
const NATIVE_BOOTSTRAP_RETRY_DELAY = 1000;
const NATIVE_BOOTSTRAP_MAX_ATTEMPTS = 30;

function detectNativePlatform() {
  if (typeof window === 'undefined') {
    return false;
  }
  const capacitor = window.Capacitor || null;
  if (!capacitor) {
    return false;
  }
  try {
    if (typeof capacitor.isNativePlatform === 'function') {
      return capacitor.isNativePlatform();
    }
    if (typeof capacitor.getPlatform === 'function') {
      const platform = capacitor.getPlatform();
      return platform === 'android' || platform === 'ios';
    }
  } catch {
    // ignore detection errors
  }
  return false;
}

const webSpeechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const nativeExpected = detectNativePlatform();

const state = {
  webSupport: webSpeechSupported,
  nativeExpected,
  support: webSpeechSupported || nativeExpected,
  provider: nativeExpected && !webSpeechSupported ? 'native' : 'web',
  webVoices: [],
  nativeVoices: [],
  voices: [],
  languageOptions: [{ value: 'all', label: 'Все языки' }],
  selectedLanguage: 'all',
  selectedVoiceId: '',
  selectedRate: 1,
  selectedPitch: 1,
  selectedVolume: 1,
  engines: webSpeechSupported ? [{ id: 'web', label: 'Browser (Web Speech API)' }] : [],
  engineId: webSpeechSupported ? 'web' : '',
  usingNative: nativeExpected && !webSpeechSupported,
  nativeReady: false,
  nativeLanguages: [],
  nativeCurrentEngine: null,
  nativePlugin: null,
  nativePluginDetected: false,
  nativePluginMissingLogged: false,
  nativeBootstrapTimer: null,
  nativeBootstrapAttempts: 0,
  nativeListeners: [],
  speaking: false,
  voicesLoaded: false,
  logEntries: [],
  pendingSettings: [],
  youtubeEmbedUrl: null,
  toastTimeout: null,
  currentUtterance: null,
  overlayFallbackActive: false,
  controlsLocked: false,
};

const elements = {
  stats: document.getElementById('stats'),
  youtubeUrl: document.getElementById('youtube-url'),
  youtubeError: document.getElementById('youtube-error'),
  youtubePreview: document.getElementById('youtube-preview'),
  youtubeIframe: document.getElementById('youtube-iframe'),
  engineSelect: document.getElementById('engine-select'),
  languageSelect: document.getElementById('language-select'),
  voiceSelect: document.getElementById('voice-select'),
  rateSelect: document.getElementById('rate-select'),
  pitchRange: document.getElementById('pitch-range'),
  pitchValue: document.getElementById('pitch-value'),
  textInput: document.getElementById('text-input'),
  speakButton: document.getElementById('speak'),
  shareButton: document.getElementById('share'),
  settingsButton: document.getElementById('settings'),
  openUrlButton: document.getElementById('open-url'),
  openYoutubeButton: document.getElementById('open-youtube'),
  closeYoutubeButton: document.getElementById('close-youtube'),
  toggleLogsButton: document.getElementById('toggle-logs'),
  logPanel: document.getElementById('log-panel'),
  logOutput: document.getElementById('log-output'),
  copyLogsButton: document.getElementById('copy-logs'),
  clearLogsButton: document.getElementById('clear-logs'),
  closeLogsButton: document.getElementById('close-logs'),
  toast: document.getElementById('toast'),
};

const languageDisplay =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['ru', 'en'], { type: 'language' })
    : null;

function stringifyPayload(payload) {
  if (payload === undefined) {
    return '';
  }
  if (payload === null) {
    return 'null';
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return String(payload);
  }
}

function log(message, payload) {
  const time = new Date().toISOString().slice(11, 23);
  const payloadText = stringifyPayload(payload);
  const entry = payload !== undefined && payloadText
    ? `${time}  ${message}\n${payloadText}`
    : `${time}  ${message}`;
  state.logEntries.push(entry);
  if (state.logEntries.length > LOG_LIMIT) {
    state.logEntries.splice(0, state.logEntries.length - LOG_LIMIT);
  }
  updateLogOutput();
  if (payload !== undefined && payloadText) {
    console.log(`[Mask2077] ${message} ${payloadText}`);
  } else {
    console.log(`[Mask2077] ${message}`);
  }
}

function logEventLog(action, payload) {
  log(`[EventLog] ${action}`, payload);
}

function logLifecycle(stage, payload) {
  log(`[Lifecycle] ${stage}`, payload);
}

logLifecycle('script-evaluated', { readyState: document.readyState });

function logEngineState(context = 'engine') {
  const domValue = elements.engineSelect ? elements.engineSelect.value : null;
  log('[SyncDebug] Engine state', {
    context,
    stateEngine: state.engineId,
    nativeEngine: state.nativeCurrentEngine,
    domEngine: domValue,
    usingNative: state.usingNative,
    nativeReady: state.nativeReady,
  });
}

function updateLogOutput() {
  if (!elements.logOutput) {
    return;
  }
  elements.logOutput.textContent = state.logEntries.join('\n\n');
}

function showToast(message) {
  if (!elements.toast) {
    return;
  }
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  if (state.toastTimeout) {
    clearTimeout(state.toastTimeout);
  }
  state.toastTimeout = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function setControlsLocked(locked) {
  const nextLocked = Boolean(locked);
  const changed = state.controlsLocked !== nextLocked;
  state.controlsLocked = nextLocked;
  const disable = nextLocked;
  if (elements.speakButton) {
    elements.speakButton.disabled = disable;
  }
  if (elements.shareButton) {
    elements.shareButton.disabled = disable;
  }
  if (elements.settingsButton) {
    elements.settingsButton.disabled = disable;
  }
  if (elements.openUrlButton) {
    elements.openUrlButton.disabled = disable;
  }
  if (elements.openYoutubeButton) {
    elements.openYoutubeButton.disabled = disable;
  }
  if (elements.closeYoutubeButton) {
    elements.closeYoutubeButton.disabled = disable;
  }
  if (elements.voiceSelect) {
    elements.voiceSelect.disabled = disable;
  }
  if (elements.languageSelect) {
    elements.languageSelect.disabled = disable;
  }
  if (elements.rateSelect) {
    elements.rateSelect.disabled = disable;
  }
  if (elements.pitchRange) {
    elements.pitchRange.disabled = disable;
  }
  if (elements.toggleLogsButton) {
    elements.toggleLogsButton.disabled = disable;
  }
  if (elements.copyLogsButton) {
    elements.copyLogsButton.disabled = disable;
  }
  if (elements.clearLogsButton) {
    elements.clearLogsButton.disabled = disable;
  }
  if (elements.closeLogsButton) {
    elements.closeLogsButton.disabled = disable;
  }
  if (elements.textInput) {
    elements.textInput.disabled = disable;
  }
  if (elements.engineSelect) {
    elements.engineSelect.disabled = disable ? true : state.engines.length <= 1;
  }
  if (changed) {
    log(`[Init] Controls ${disable ? 'locked' : 'unlocked'}`);
  }
}

function getNativePlugin() {
  if (state.nativePlugin) {
    return state.nativePlugin;
  }
  const capacitor = window.Capacitor || {};
  const plugins = capacitor.Plugins || window.CapacitorPlugins;
  if (plugins && plugins.NativeTTS) {
    state.nativePlugin = plugins.NativeTTS;
    if (!state.nativePluginDetected) {
      log('[NativeTTS] Plugin reference acquired via Capacitor');
    }
    state.nativePluginDetected = true;
    state.nativePluginMissingLogged = false;
    return state.nativePlugin;
  }
  if (!state.overlayFallbackActive) {
    activateOverlayFallback('plugin-missing');
    if (state.nativePlugin) {
      return state.nativePlugin;
    }
  }
  if (!state.nativePluginMissingLogged) {
    log('[NativeTTS] Plugin not available yet', {
      hasCapacitor: Boolean(capacitor),
      hasPlugins: Boolean(plugins),
    });
    state.nativePluginMissingLogged = true;
  }
  return null;
}

function activateOverlayFallback(reason) {
  if (state.overlayFallbackActive) {
    return true;
  }
  const bridge = window.NativeOverlayBridge;
  if (!bridge || typeof bridge.postMessage !== 'function') {
    log('[Support] Overlay fallback unavailable', {
      reason,
      hasBridge: Boolean(bridge),
      bridgeType: bridge ? typeof bridge : null,
    });
    return false;
  }

  log('[Support] Capacitor fallback runtime activated', { reason });
  state.overlayFallbackActive = true;

  const pending = new Map();
  const listeners = new Map();
  let requestCounter = 0;

  const ensureListenerMap = (eventName) => {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Map());
    }
    return listeners.get(eventName);
  };

  const dispatchMessage = (raw) => {
    let message = raw;
    if (!message) {
      return;
    }
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message);
      } catch (error) {
        log('[Support] Overlay dispatch parse error', {
          raw,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    const { type } = message;
    if (type === 'response') {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        entry.reject(
          message.error.message
            ? new Error(message.error.message)
            : message.error
        );
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (type === 'event') {
      const eventName = message.event;
      const map = listeners.get(eventName);
      if (!map) {
        return;
      }
      map.forEach((callback) => {
        try {
          callback(message.data || {});
        } catch (error) {
          log('[Support] Overlay event handler error', {
            event: eventName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }
    if (type === 'log') {
      log('[NativeOverlay]', { message: message.message });
      return;
    }
    log('[Support] Overlay dispatch received unknown message', message);
  };

  if (typeof window.__nativeOverlayDispatch === 'function') {
    const previousDispatch = window.__nativeOverlayDispatch;
    window.__nativeOverlayDispatch = (message) => {
      dispatchMessage(message);
      try {
        previousDispatch(message);
      } catch (error) {
        log('[Support] Overlay dispatch chain error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
  } else {
    window.__nativeOverlayDispatch = dispatchMessage;
  }

  const sendMessage = (message) => {
    try {
      bridge.postMessage(JSON.stringify(message));
    } catch (error) {
      log('[Support] Overlay fallback postMessage failed', {
        message,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const invoke = (method, params) =>
    new Promise((resolve, reject) => {
      const id = String(++requestCounter);
      pending.set(id, { resolve, reject });
      sendMessage({
        type: 'request',
        id,
        plugin: 'NativeTTS',
        method,
        params: params || {},
      });
    });

  const registerListener = async (eventName, callback) => {
    if (!eventName || typeof callback !== 'function') {
      return { remove: async () => {} };
    }
    const map = ensureListenerMap(eventName);
    const listenerId = `L${++requestCounter}`;
    map.set(listenerId, callback);
    sendMessage({
      type: 'addListener',
      plugin: 'NativeTTS',
      event: eventName,
      listenerId,
    });
    return {
      remove: async () => {
        const current = listeners.get(eventName);
        if (current && current.has(listenerId)) {
          current.delete(listenerId);
          sendMessage({
            type: 'removeListener',
            plugin: 'NativeTTS',
            event: eventName,
            listenerId,
          });
        }
      },
    };
  };

  const proxy = {
    isAvailable: (params) => invoke('isAvailable', params),
    getEngines: (params) => invoke('getEngines', params),
    selectEngine: (params) => invoke('selectEngine', params),
    getVoices: (params) => invoke('getVoices', params),
    getAvailableLanguages: (params) => invoke('getAvailableLanguages', params),
    speak: (params) => invoke('speak', params),
    stop: (params) => invoke('stop', params),
    setPitch: (params) => invoke('setPitch', params),
    setSpeechRate: (params) => invoke('setSpeechRate', params),
    synthesizeToFile: (params) => invoke('synthesizeToFile', params),
    shareAudio: (params) => invoke('shareAudio', params),
    openSettings: (params) => invoke('openSettings', params),
    getLogs: (params) => invoke('getLogs', params),
    clearLogs: (params) => invoke('clearLogs', params),
    addListener: (eventName, callback) => registerListener(eventName, callback),
  };

  state.nativePlugin = proxy;
  state.nativePluginDetected = true;
  state.nativePluginMissingLogged = false;

  return true;
}

function clearNativeListeners() {
  if (!state.nativeListeners.length) {
    return;
  }
  state.nativeListeners.forEach((subscription) => {
    try {
      subscription?.remove?.();
    } catch (error) {
      log('[NativeTTS] listener removal failed', error instanceof Error ? error.message : error);
    }
  });
  state.nativeListeners = [];
}

async function attachNativeListener(eventName, handler) {
  const plugin = getNativePlugin();
  if (!plugin?.addListener) {
    return;
  }
  try {
    const subscription = await plugin.addListener(eventName, handler);
    state.nativeListeners.push(subscription);
  } catch (error) {
    log(`[NativeTTS] addListener ${eventName} failed`, error instanceof Error ? error.message : error);
  }
}

function createVoiceEntry({ id, name, lang, provider, voice, nativeId, quality }) {
  return {
    id: id || '',
    name: name || id || 'Voice',
    lang: lang || '',
    provider,
    voice: voice ?? null,
    nativeId: nativeId ?? null,
    quality: quality ?? null,
  };
}

function listVoicesForProvider(provider) {
  if (provider === 'native') {
    return state.nativeVoices.slice();
  }
  return state.webVoices.slice();
}

function ensureVoiceSelection() {
  if (!elements.voiceSelect) {
    return;
  }
  if (state.voices.length === 0) {
    state.selectedVoiceId = '';
    elements.voiceSelect.value = '';
    log('[Voices] No voices for provider', { provider: state.provider });
    return;
  }
  if (!state.selectedVoiceId || !state.voices.some((voice) => voice.id === state.selectedVoiceId)) {
    state.selectedVoiceId = state.voices[0].id;
    log('[Voices] Auto-selected voice', { provider: state.provider, voice: state.selectedVoiceId });
  }
  elements.voiceSelect.value = state.selectedVoiceId;
}

function applyProvider(provider, engineId) {
  state.provider = provider;
  state.usingNative = provider === 'native';
  if (engineId) {
    state.engineId = engineId;
  } else if (provider === 'web') {
    state.engineId = 'web';
  } else if (provider === 'native' && state.nativeCurrentEngine) {
    state.engineId = state.nativeCurrentEngine;
  }
  state.voices = listVoicesForProvider(provider);
  ensureVoiceSelection();
  rebuildLanguageOptions();
  rebuildVoiceOptions();
  updateStats();
  if (state.controlsLocked && (state.nativeReady || state.voices.length > 0)) {
    setControlsLocked(false);
  }
  if (elements.engineSelect) {
    elements.engineSelect.value = state.engineId || '';
  }
  log('[Provider] Applied', { provider, engine: state.engineId, voices: state.voices.length });
  log('[SyncDebug] Engine selection applied', {
    provider,
    stateEngine: state.engineId,
    nativeEngine: state.nativeCurrentEngine,
  });
  logEngineState('applyProvider');
}

function getAllVoices() {
  return [...state.nativeVoices, ...state.webVoices];
}

function findVoiceByHint(hint) {
  if (!hint) {
    return null;
  }
  const value = String(hint).toLowerCase();
  return (
    getAllVoices().find((voice) => voice.id.toLowerCase() === value) ||
    getAllVoices().find((voice) => voice.nativeId && voice.nativeId.toLowerCase() === value) ||
    getAllVoices().find((voice) => voice.name && voice.name.toLowerCase() === value) ||
    null
  );
}

function formatLanguage(lang) {
  if (!lang) {
    return 'Неизвестный язык';
  }
  const sanitized = lang.replace(/_/g, '-');
  if (languageDisplay) {
    try {
      const display = languageDisplay.of(sanitized.toLowerCase());
      if (display && display !== sanitized.toLowerCase()) {
        return `${display} (${sanitized})`;
      }
    } catch {
      // ignore invalid locale errors
    }
  }
  return sanitized;
}

function rebuildLanguageOptions() {
  const languages = new Map();
  state.voices.forEach((voice) => {
    if (!voice.lang) {
      return;
    }
    const code = voice.lang.split('-')[0]?.toLowerCase() || voice.lang.toLowerCase();
    if (!languages.has(code)) {
      languages.set(code, formatLanguage(voice.lang));
    }
  });

  state.nativeLanguages.forEach((lang) => {
    if (!lang) {
      return;
    }
    const code = String(lang).toLowerCase();
    if (!languages.has(code)) {
      languages.set(code, formatLanguage(lang));
    }
  });

  const options = [{ value: 'all', label: 'Все языки' }];
  Array.from(languages.entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'ru', { sensitivity: 'base' }))
    .forEach(([code, label]) => options.push({ value: code, label }));

  state.languageOptions = options;
  populateSelect(elements.languageSelect, options, state.selectedLanguage);
}

function populateSelect(select, options, selectedValue) {
  if (!select) {
    return;
  }
  select.innerHTML = '';
  options.forEach((option) => {
    const optionEl = document.createElement('option');
    optionEl.value = String(option.value);
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  });
  if (selectedValue && options.some((option) => String(option.value) === String(selectedValue))) {
    select.value = String(selectedValue);
  } else {
    select.selectedIndex = 0;
    state.selectedLanguage = options[0]?.value ?? 'all';
  }
}

function rebuildVoiceOptions() {
  const filtered = state.selectedLanguage === 'all'
    ? state.voices
    : state.voices.filter((voice) => (voice.lang || '').toLowerCase().startsWith(state.selectedLanguage));

  const options = filtered.map((voice) => {
    const providerLabel = voice.provider === 'native' ? 'native' : 'web';
    return {
      value: voice.id,
      label: `${voice.name} · ${formatLanguage(voice.lang)} · ${providerLabel}`,
    };
  });

  if (options.length === 0) {
    options.push({ value: '', label: 'Голоса недоступны' });
    state.selectedVoiceId = '';
  } else if (!options.some((option) => option.value === state.selectedVoiceId)) {
    state.selectedVoiceId = options[0].value;
  }

  populateSelect(elements.voiceSelect, options, state.selectedVoiceId);
}

function rebuildEngineOptions() {
  const options = state.engines.map((engine) => ({
    value: engine.id,
    label: engine.label,
  }));
  log('[SyncDebug] Engine options updated', {
    options: options.map((option) => option.value),
    count: options.length,
  });
  populateSelect(elements.engineSelect, options, state.engineId);
  if (elements.engineSelect) {
    elements.engineSelect.value = options.some((option) => option.value === state.engineId)
      ? state.engineId
      : '';
    elements.engineSelect.disabled =
      state.controlsLocked || options.length <= 1;
    log('[SyncDebug] Engine dropdown value applied', {
      stateEngine: state.engineId,
      domEngine: elements.engineSelect.value,
    });
  }
  logEngineState('rebuildEngineOptions');
}

function updateStats() {
  if (!elements.stats) {
    return;
  }
  if (!state.support) {
    elements.stats.textContent =
      'Web Speech API не поддерживается в этом браузере. Синтез речи ограничен.';
    return;
  }
  const providerLabel = state.provider === 'native' ? 'устройство' : 'браузер';
  if (!state.webSupport && state.nativeExpected) {
    elements.stats.textContent = 'Web Speech API недоступен, используется нативный синтез речи устройства.';
    return;
  }
  const voiceCount = state.voices.length;
  const engineCount = state.engines.length;
  elements.stats.textContent = `Данные синхронизированы с локальным движком: ${providerLabel} · ${voiceCount} голосов · ${engineCount} движок(ов)`;
}

function updateSpeakButton() {
  if (!elements.speakButton) {
    return;
  }
  elements.speakButton.textContent = state.speaking ? 'Остановить' : 'Синтез';
  elements.speakButton.classList.toggle('btn--ghost', state.speaking);
  elements.speakButton.classList.toggle('btn--primary', !state.speaking);
}

function sanitizeRate(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(Math.max(numeric, 0.2), 4);
}

function sanitizePitch(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(Math.max(numeric, 0.2), 2);
}

function sanitizeVolume(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(Math.max(numeric, 0), 1);
}

function detectVoice(match) {
  return findVoiceByHint(match);
}

function applyVoiceSelection(voice, options = {}) {
  if (!voice) {
    return;
  }
  const silent = Boolean(options.silent);
  if (voice.provider === 'native' && state.provider !== 'native') {
    const engineId = state.nativeCurrentEngine || state.engineId;
    applyProvider('native', engineId && engineId !== 'web' ? engineId : state.nativeCurrentEngine);
  } else if (voice.provider === 'web' && state.provider !== 'web') {
    applyProvider('web', 'web');
  }
  state.selectedVoiceId = voice.id;
  if (elements.voiceSelect) {
    elements.voiceSelect.value = voice.id;
  }
  const langCode = (voice.lang || '').split('-')[0]?.toLowerCase();
  if (langCode && state.selectedLanguage !== langCode) {
    state.selectedLanguage = langCode;
    if (elements.languageSelect) {
      elements.languageSelect.value = langCode;
    }
    rebuildVoiceOptions();
    if (elements.voiceSelect) {
      elements.voiceSelect.value = state.selectedVoiceId;
    }
  }
  if (!silent) {
    log('[TTS] Voice selected', {
      voice: voice.name,
      lang: voice.lang,
      provider: voice.provider,
      nativeId: voice.nativeId ?? undefined,
    });
  } else {
    log('[TTS] Voice selection updated (silent)', {
      voice: voice.name,
      provider: voice.provider,
    });
  }
}

function speak() {
  const text = (elements.textInput.value || '').trim();
  if (!text) {
    showToast('Введите текст для синтеза');
    log('[TTS] Cannot speak: text is empty');
    return;
  }

  if (state.speaking) {
    void cancelSpeech();
    return;
  }

  const voice = findVoiceByHint(state.selectedVoiceId);

  if (state.provider === 'native') {
    const plugin = getNativePlugin();
    if (!plugin || typeof plugin.speak !== 'function') {
      showToast('Нативный синтез недоступен');
      log('[NativeTTS] Plugin not available');
      return;
    }
    state.speaking = true;
    updateSpeakButton();
    plugin
      .speak({
        text,
        voiceId: voice?.nativeId || voice?.id || undefined,
        rate: state.selectedRate,
        pitch: state.selectedPitch,
      })
      .then(() => {
        log('[NativeTTS] Speak requested', {
          chars: text.length,
          rate: state.selectedRate,
          pitch: state.selectedPitch,
          voice: voice?.name ?? null,
          engine: state.nativeCurrentEngine || state.engineId,
        });
      })
      .catch((error) => {
        state.speaking = false;
        updateSpeakButton();
        const message = error instanceof Error ? error.message : String(error);
        log('[NativeTTS] speak failed', message);
        showToast('Не удалось запустить синтез');
      });
    return;
  }

  if (!state.webSupport) {
    showToast('Синтез речи недоступен в этом браузере');
    log('[WebTTS] Speech synthesis not supported');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = state.selectedRate;
  utterance.pitch = state.selectedPitch;
  if (typeof state.selectedVolume === 'number') {
    utterance.volume = state.selectedVolume;
  }
  if (voice?.voice) {
    utterance.voice = voice.voice;
  }

  utterance.onstart = () => {
    state.speaking = true;
    updateSpeakButton();
    log('[WebTTS] Speech started', {
      voice: utterance.voice?.name ?? 'default',
      rate: utterance.rate,
      pitch: utterance.pitch,
      volume: utterance.volume,
      chars: text.length,
    });
  };

  utterance.onend = () => {
    state.speaking = false;
    updateSpeakButton();
    log('[WebTTS] Speech ended');
  };

  utterance.onerror = (event) => {
    state.speaking = false;
    updateSpeakButton();
    log('[WebTTS] Speech error', event.error || 'unknown error');
  };

  state.currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

async function cancelSpeech() {
  if (state.provider === 'native') {
    const plugin = getNativePlugin();
    if (plugin && typeof plugin.stop === 'function') {
      try {
        await plugin.stop();
        log('[NativeTTS] Stop requested');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('[NativeTTS] stop failed', message);
      }
    }
    state.speaking = false;
    updateSpeakButton();
    return;
  }
  if (!state.webSupport) {
    return;
  }
  window.speechSynthesis.cancel();
  state.speaking = false;
  updateSpeakButton();
  log('[WebTTS] Speech cancelled');
}

async function refreshNativeEngines() {
  const plugin = getNativePlugin();
  if (!plugin || typeof plugin.getEngines !== 'function') {
    return;
  }
  try {
    const result = await plugin.getEngines();
    const engines = Array.isArray(result?.engines) ? result.engines : [];
    const mapped = engines
      .map((engine) => {
        if (!engine) {
          return null;
        }
        if (typeof engine === 'string') {
          return { id: engine, label: engine };
        }
        return {
          id: engine.id || engine.label || '',
          label: engine.label || engine.id || 'Engine',
        };
      })
      .filter((engine) => engine && engine.id);
    const unique = new Map();
    mapped.forEach((engine) => {
      if (!unique.has(engine.id)) {
        unique.set(engine.id, engine);
      }
    });
    const combined = [
      ...(state.webSupport ? [{ id: 'web', label: 'Browser (Web Speech API)' }] : []),
      ...unique.values(),
    ];
    state.engines = combined;
    state.nativeCurrentEngine = result?.currentEngine || state.nativeCurrentEngine || mapped[0]?.id || null;
    rebuildEngineOptions();
    updateStats();
    log('[NativeTTS] Engines synchronized', {
      engines: mapped.map((engine) => engine.id),
      current: state.nativeCurrentEngine,
    });
    logEngineState('refreshNativeEngines');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('[NativeTTS] getEngines failed', message);
  }
}

async function refreshNativeVoices() {
  const plugin = getNativePlugin();
  if (!plugin || typeof plugin.getVoices !== 'function') {
    return;
  }
  try {
    const result = await plugin.getVoices();
    const incoming = Array.isArray(result?.voices) ? result.voices : [];
    state.nativeVoices = incoming.map((voice, index) =>
      createVoiceEntry({
        id: `native-${voice?.id || index}`,
        name: voice?.name || voice?.id || `Voice ${index + 1}`,
        lang: voice?.locale || voice?.language || '',
        provider: 'native',
        nativeId: voice?.id || null,
        quality: voice?.quality ?? null,
      })
    );
    if (state.provider === 'native') {
      state.voices = listVoicesForProvider('native');
      ensureVoiceSelection();
      rebuildLanguageOptions();
      rebuildVoiceOptions();
    }
    if (state.controlsLocked && state.nativeVoices.length > 0) {
      setControlsLocked(false);
    }
    log('[NativeTTS] Voices synchronized', { count: state.nativeVoices.length, voices: state.nativeVoices.map((voice) => ({ id: voice.nativeId ?? voice.id, name: voice.name, lang: voice.lang })).slice(0, 5) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('[NativeTTS] getVoices failed', message);
  }
}

async function refreshNativeLanguages() {
  const plugin = getNativePlugin();
  if (!plugin || typeof plugin.getAvailableLanguages !== 'function') {
    return;
  }
  try {
    const result = await plugin.getAvailableLanguages();
    state.nativeLanguages = Array.isArray(result?.languages) ? result.languages : [];
    log('[NativeTTS] Languages synchronized', { count: state.nativeLanguages.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('[NativeTTS] getAvailableLanguages failed', message);
  }
}

async function selectNativeEngine(engineId) {
  const plugin = getNativePlugin();
  if (!plugin || typeof plugin.selectEngine !== 'function') {
    return;
  }
  try {
    await plugin.selectEngine({ engineId });
    state.nativeCurrentEngine = engineId;
    log('[NativeTTS] Engine selected', engineId);
    await refreshNativeVoices();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('[NativeTTS] selectEngine failed', message);
  }
}

function scheduleNativeBootstrapRetry(reason) {
  if (state.nativeReady) {
    return;
  }
  if (state.nativeBootstrapAttempts >= NATIVE_BOOTSTRAP_MAX_ATTEMPTS) {
    state.nativeBootstrapTimer = null;
    log('[NativeTTS] Bootstrap retries exhausted', { reason, attempts: state.nativeBootstrapAttempts });
    return;
  }
  if (state.nativeBootstrapTimer) {
    log('[NativeTTS] Bootstrap retry already scheduled', {
      reason,
      attempt: state.nativeBootstrapAttempts,
    });
    return;
  }
  state.nativeBootstrapTimer = window.setTimeout(() => {
    state.nativeBootstrapTimer = null;
    logLifecycle('init:bootstrap-native');
  void bootstrapNative();
  }, NATIVE_BOOTSTRAP_RETRY_DELAY);
  log('[NativeTTS] Bootstrap retry scheduled', {
    reason,
    attempt: state.nativeBootstrapAttempts,
    delay: NATIVE_BOOTSTRAP_RETRY_DELAY,
  });
}
async function bootstrapNative() {
  state.nativeBootstrapAttempts += 1;
  log('[NativeTTS] bootstrap start', { attempt: state.nativeBootstrapAttempts });
  const plugin = getNativePlugin();
  if (!plugin) {
    log('[NativeTTS] Plugin not detected', { nativeReady: state.nativeReady });
    scheduleNativeBootstrapRetry('plugin-missing');
    return;
  }
  try {
    const availableResult = typeof plugin.isAvailable === 'function' ? await plugin.isAvailable() : { available: true };
    const available = !!availableResult?.available;
    log('[NativeTTS] Availability', { available, raw: availableResult });
    if (!available) {
      log('[NativeTTS] Plugin reported unavailable');
      scheduleNativeBootstrapRetry('plugin-unavailable');
      return;
    }
    await refreshNativeEngines();
    await refreshNativeVoices();
    await refreshNativeLanguages();
    state.nativeReady = true;
    state.support = true;
    setControlsLocked(false);
    if (state.nativeBootstrapTimer) {
      clearTimeout(state.nativeBootstrapTimer);
      state.nativeBootstrapTimer = null;
    }
    state.nativeBootstrapAttempts = 0;
    updateStats();
    const engineId =
      state.nativeCurrentEngine ||
      state.engines.find((engine) => engine.id !== 'web')?.id ||
      null;
    if (engineId) {
      applyProvider('native', engineId);
    }
    clearNativeListeners();
    await attachNativeListener('log', (event) => {
      if (event?.message) {
        log('[NativeTTS] ' + event.message);
      }
    });
    await attachNativeListener('ttsState', (event) => {
      if (!event?.state) {
        return;
      }
      if (event.state === 'start') {
        state.speaking = true;
        updateSpeakButton();
        log('[NativeTTS] Playback started');
      } else if (event.state === 'done') {
        state.speaking = false;
        updateSpeakButton();
        log('[NativeTTS] Playback completed');
      } else if (event.state === 'error') {
        state.speaking = false;
        updateSpeakButton();
        log('[NativeTTS] Playback error');
        showToast('Ошибка нативного синтеза');
      }
    });
    log('[NativeTTS] Bridge ready', {
      engine: state.nativeCurrentEngine,
      voices: state.nativeVoices.length,
      languages: state.nativeLanguages.length,
    });
    tryApplyPendingSettings();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('[NativeTTS] bootstrap failed', message);
    scheduleNativeBootstrapRetry('error');
  }
}

function handleShare() {
  const text = (elements.textInput.value || '').trim();
  if (!text) {
    showToast('Нечего шарить — текст пустой');
    return;
  }
  if (navigator.share) {
    navigator
      .share({ text })
      .then(() => log('[Share] navigator.share success'))
      .catch((error) => log('[Share] navigator.share failed', error?.message ?? error));
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast('Текст скопирован в буфер обмена');
        log('[Share] Clipboard copy success');
      })
      .catch((error) => log('[Share] Clipboard copy failed', error?.message ?? error));
  } else {
    log('[Share] Clipboard API not available');
  }
}

function handleSettings() {
  log('[TTS] Settings requested');
  showToast('Откройте настройки TTS на устройстве вручную');
}

function buildYoutubeEmbedUrl(rawValue) {
  const input = (rawValue || '').trim();
  if (!input) {
    return null;
  }

  const ensureProtocol = (value) => {
    if (/^[a-zA-Z]+:\/\//.test(value)) {
      return value;
    }
    if (value.includes('.')) {
      return `https://${value}`;
    }
    return value;
  };

  const parse = (candidate) => {
    try {
      return new URL(candidate);
    } catch {
      return null;
    }
  };

  const embedFromVideoId = (videoId, params) => {
    if (!videoId) {
      return null;
    }
    const url = new URL(`${YOUTUBE_EMBED_BASE_URL}${videoId}`);
    if (params) {
      params.forEach((value, key) => {
        if (key.toLowerCase() !== 'v') {
          url.searchParams.append(key, value);
        }
      });
    }
    return url.toString();
  };

  const firstPass = parse(ensureProtocol(input));
  if (firstPass) {
    const host = firstPass.hostname.toLowerCase();
    const path = firstPass.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const [videoId] = path;
      return embedFromVideoId(videoId ?? '', firstPass.searchParams);
    }

    if (host.endsWith('youtube.com')) {
      const [firstSegment, secondSegment] = path;
      if (firstSegment === 'watch') {
        const videoId = firstPass.searchParams.get('v') ?? '';
        firstPass.searchParams.delete('v');
        return embedFromVideoId(videoId, firstPass.searchParams);
      }
      if (firstSegment === 'shorts' || firstSegment === 'live') {
        return embedFromVideoId(secondSegment ?? '', firstPass.searchParams);
      }
      if (firstSegment === 'embed') {
        return firstPass.toString();
      }
    }
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return `${YOUTUBE_EMBED_BASE_URL}${input}`;
  }

  return null;
}

function openYoutubeEmbed(url) {
  const embedUrl = buildYoutubeEmbedUrl(url);
  if (!embedUrl) {
    elements.youtubeError.hidden = false;
    elements.youtubeError.textContent = 'Не удалось распознать ссылку. Укажите ссылку на конкретное видео.';
    log('[YouTube] Failed to parse URL', url);
    return;
  }
  elements.youtubeError.hidden = true;
  state.youtubeEmbedUrl = embedUrl;
  elements.youtubeIframe.src = embedUrl;
  elements.youtubePreview.hidden = false;
  log('[YouTube] Embed attached', embedUrl);
}

function closeYoutubeEmbed() {
  elements.youtubePreview.hidden = true;
  elements.youtubeIframe.src = '';
  state.youtubeEmbedUrl = null;
  log('[YouTube] Embed closed');
}

function normalizeSettingsForApply(settings, source) {
  if (!settings || typeof settings !== 'object') {
    return { payload: null, needsNative: false };
  }
  const payload = { ...settings };
  const wantsNative =
    payload.usingNative === true ||
    (typeof payload.engine === 'string' && payload.engine !== 'web');
  const nativeCapable =
    state.nativeExpected || state.nativePluginDetected || state.nativeReady;
  if (wantsNative && !nativeCapable) {
    payload.usingNative = false;
    if (payload.engine && payload.engine !== 'web') {
      payload.engine = 'web';
    }
    log('[Bridge] Native settings ignored (fallback to web)', {
      source,
      requestedEngine: settings.engine ?? null,
      nativeExpected: state.nativeExpected,
      nativeReady: state.nativeReady,
      pluginDetected: state.nativePluginDetected,
    });
  }
  const needsNative =
    payload.usingNative === true ||
    (typeof payload.engine === 'string' && payload.engine !== 'web');
  return { payload, needsNative };
}

function tryApplyPendingSettings() {
  if (state.pendingSettings.length === 0) {
    return;
  }
  if (state.support !== false && !state.voicesLoaded && !state.nativeReady) {
    return;
  }
  log('[Bridge] Flushing pending settings', {
    queued: state.pendingSettings.length,
    nativeReady: state.nativeReady,
    voicesLoaded: state.voicesLoaded,
  });
  const stillWaiting = [];
  while (state.pendingSettings.length > 0) {
    const entry = state.pendingSettings.shift();
    if (!entry) {
      continue;
    }
    const { payload, needsNative } = normalizeSettingsForApply(entry.settings, entry.source);
    if (!payload) {
      continue;
    }
    if (needsNative && !state.nativeReady) {
      log('[Bridge] Waiting for native resources', { source: entry.source });
      stillWaiting.push({ settings: payload, source: entry.source });
      continue;
    }
    internalApplySettings(payload, entry.source);
    log('[Bridge] Applied queued settings', { source: entry.source });
    logEngineState('applySettings:queue-flush');
  }
  if (stillWaiting.length > 0) {
    state.pendingSettings.push(...stillWaiting);
    log('[Bridge] Still waiting for native resources', { remaining: stillWaiting.length });
    logEngineState('applySettings:queue-waiting');
  }
}

function internalApplySettings(settings, source = 'external') {
  if (!settings || typeof settings !== 'object') {
    return;
  }

  const applied = {};

  if (Array.isArray(settings.engines)) {
    const normalized = settings.engines
      .map((engine) => {
        if (!engine) {
          return null;
        }
        if (typeof engine === 'string') {
          return { id: engine, label: engine };
        }
        if (engine.id) {
          return { id: engine.id, label: engine.label || engine.id };
        }
        return null;
      })
      .filter(Boolean);
    if (normalized.length > 0) {
      const combined = new Map(state.engines.map((engine) => [engine.id, engine]));
      normalized.forEach((engine) => {
        combined.set(engine.id, engine);
      });
      if (!combined.has('web')) {
        combined.set('web', { id: 'web', label: 'Browser (Web Speech API)' });
      }
      state.engines = [
        combined.get('web'),
        ...Array.from(combined.values()).filter((engine) => engine.id !== 'web'),
      ].filter(Boolean);
      rebuildEngineOptions();
      applied.engines = normalized.map((engine) => engine.id);
    }
  }

  if (typeof settings.engine === 'string') {
    const engineId = settings.engine;
    applied.engine = engineId;
    if (engineId === 'web') {
      applyProvider('web', 'web');
      if (elements.engineSelect) {
        elements.engineSelect.value = 'web';
      }
    } else {
      state.nativeCurrentEngine = engineId;
      applyProvider('native', engineId);
      if (elements.engineSelect) {
        elements.engineSelect.value = engineId;
      }
      void selectNativeEngine(engineId);
    }
  }

  if (typeof settings.usingNative === 'boolean') {
    if (settings.usingNative) {
      const engineId =
        settings.engine && settings.engine !== 'web'
          ? settings.engine
          : state.nativeCurrentEngine || state.engines.find((engine) => engine.id !== 'web')?.id;
      if (engineId) {
        state.nativeCurrentEngine = engineId;
        applyProvider('native', engineId);
        void selectNativeEngine(engineId);
      }
    } else {
      applyProvider('web', 'web');
    }
    applied.usingNative = settings.usingNative;
  }

  if (typeof settings.text === 'string') {
    if (elements.textInput) {
      elements.textInput.value = settings.text;
    }
    applied.text = settings.text.length;
  }

  if (settings.language) {
    const language = String(settings.language).toLowerCase();
    if (state.languageOptions.some((option) => option.value === language)) {
      state.selectedLanguage = language;
      if (elements.languageSelect) {
        elements.languageSelect.value = language;
      }
      rebuildVoiceOptions();
      applied.language = language;
    } else {
      applied.language = 'pending';
    }
  }

  if (settings.rate !== undefined) {
    state.selectedRate = sanitizeRate(settings.rate);
    if (elements.rateSelect) {
      elements.rateSelect.value = String(state.selectedRate);
    }
    applied.rate = state.selectedRate;
  }

  if (settings.pitch !== undefined) {
    state.selectedPitch = sanitizePitch(settings.pitch);
    if (elements.pitchRange) {
      elements.pitchRange.value = String(state.selectedPitch);
    }
    if (elements.pitchValue) {
      elements.pitchValue.textContent = state.selectedPitch.toFixed(2);
    }
    applied.pitch = state.selectedPitch;
  }

  if (settings.volume !== undefined) {
    state.selectedVolume = sanitizeVolume(settings.volume);
    applied.volume = state.selectedVolume;
  }

  if (settings.voice || settings.voiceURI || settings.voiceName) {
    const targetVoice =
      detectVoice(settings.voiceURI) ||
      detectVoice(settings.voice) ||
      detectVoice(settings.voiceName);
    if (targetVoice) {
      applyVoiceSelection(targetVoice);
      applied.voice = targetVoice.name;
    } else {
      applied.voice = 'not-found';
      log('[Bridge] Requested voice not found', {
        voice: settings.voice ?? settings.voiceName ?? settings.voiceURI,
        provider: state.provider,
      });
    }
  }
  updateStats();

  if (Object.keys(applied).length > 0) {
    log(`[Bridge] Settings applied (${source})`, applied);
    logEngineState('internalApplySettings');
  }

  if (settings.autoplay) {
    log('[Bridge] Autoplay requested');
    speak();
  }
}

function applySettings(settings, source) {
  const { payload, needsNative } = normalizeSettingsForApply(settings, source);
  if (!payload) {
    return;
  }
  if (!state.voicesLoaded || (needsNative && !state.nativeReady)) {
    state.pendingSettings.push({ settings: payload, source });
    log('[Bridge] Queued settings (waiting for resources)', { source, needsNative });
    logEngineState('applySettings:queued');
    tryApplyPendingSettings();
    return;
  }
  log('[Bridge] Applying settings directly', { source, needsNative });
  internalApplySettings(payload, source);
  logEngineState('applySettings:direct');
}

function parseParams(searchParams) {
  const settings = {};
  if (searchParams.has('text')) {
    settings.text = searchParams.get('text');
  }
  if (searchParams.has('rate')) {
    settings.rate = parseFloat(searchParams.get('rate') || '');
  }
  if (searchParams.has('pitch')) {
    settings.pitch = parseFloat(searchParams.get('pitch') || '');
  }
  if (searchParams.has('volume')) {
    settings.volume = parseFloat(searchParams.get('volume') || '');
  }
  if (searchParams.has('voice')) {
    settings.voice = searchParams.get('voice');
  }
  if (searchParams.has('voiceURI')) {
    settings.voiceURI = searchParams.get('voiceURI');
  }
  if (searchParams.has('voiceName')) {
    settings.voiceName = searchParams.get('voiceName');
  }
  if (searchParams.has('language')) {
    settings.language = searchParams.get('language');
  }
  if (searchParams.has('engine')) {
    settings.engine = searchParams.get('engine');
  }
  if (searchParams.get('autoplay') === '1') {
    settings.autoplay = true;
  }
  return settings;
}

function handleMessage(event) {
  const { data } = event;
  if (!data) {
    return;
  }
  if (data.type === 'mask2077:tts-settings') {
    const payload = data.payload !== undefined ? data.payload : data.settings;
    log('[Bridge] Received settings message', payload);
    applySettings(payload, 'postMessage');
  }
}

function toggleLogs(visible, reason = 'auto') {
  if (!elements.logPanel || !elements.toggleLogsButton) {
    logLifecycle('ui:toggleLogs:skipped', {
      hasPanel: Boolean(elements.logPanel),
      hasToggle: Boolean(elements.toggleLogsButton),
    });
    return;
  }
  const target = visible ?? elements.logPanel.hidden;
  elements.logPanel.hidden = !target;
  if (target) {
    elements.logPanel.removeAttribute('hidden');
  } else {
    elements.logPanel.setAttribute('hidden', '');
  }
  elements.toggleLogsButton.textContent = target ? 'Скрыть журнал' : 'Журнал';
  logEventLog(target ? 'opened' : 'closed', { reason, visible: target });
}
function clearLogs(reason = 'user') {
  state.logEntries = [];
  updateLogOutput();
  logEventLog('cleared', { reason });
}

function copyLogs() {
  const content = state.logEntries.join('\n\n');
  if (!content) {
    showToast('Журнал пуст');
    logEventLog('copy-skipped', { reason: 'empty' });
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        logEventLog('copied', { entries: state.logEntries.length });
        showToast('Журнал скопирован');
      })
      .catch((error) => {
        logEventLog('copy-error', { message: error?.message ?? String(error) });
        log('[Logs] Copy failed', error?.message ?? error);
      });
  } else {
    logEventLog('copy-error', { reason: 'clipboard-api-unavailable' });
    log('[Logs] Clipboard API not available');
  }
}

async function handleEngineChange(event) {
  const value = event.target.value;
  if (value === 'web') {
    applyProvider('web', 'web');
    log('[TTS] Engine changed', 'web');
    return;
  }
  const plugin = getNativePlugin();
  if (!plugin || typeof plugin.selectEngine !== 'function') {
    showToast('Нативный движок недоступен');
    log('[NativeTTS] selectEngine unavailable');
    if (elements.engineSelect) {
      elements.engineSelect.value = 'web';
    }
    applyProvider('web', 'web');
    return;
  }
  state.engineId = value;
  state.nativeCurrentEngine = value;
  applyProvider('native', value);
  log('[TTS] Engine changed', value);
  if (elements.engineSelect) {
    elements.engineSelect.value = value;
  }
  await selectNativeEngine(value);
  logEngineState('handleEngineChange');
}

function handleLanguageChange(event) {
  state.selectedLanguage = event.target.value;
  rebuildVoiceOptions();
  ensureVoiceSelection();
  log('[TTS] Language filter', state.selectedLanguage);
}

function handleVoiceChange(event) {
  state.selectedVoiceId = event.target.value;
  const voice = detectVoice(state.selectedVoiceId);
  if (voice) {
    applyVoiceSelection(voice, { silent: true });
    log('[TTS] Voice changed', { voice: voice.name, lang: voice.lang, provider: voice.provider });
  } else {
    log('[TTS] Voice not found after change', state.selectedVoiceId);
  }
}

function handleRateChange(event) {
  state.selectedRate = sanitizeRate(event.target.value);
  log('[TTS] Rate change', state.selectedRate);
}

function handlePitchChange(event) {
  state.selectedPitch = sanitizePitch(event.target.value);
  if (elements.pitchValue) {
    elements.pitchValue.textContent = state.selectedPitch.toFixed(2);
  }
  log('[TTS] Pitch change', state.selectedPitch);
}

function handleOpenYoutube() {
  window.open(YOUTUBE_MOBILE_URL, '_blank', 'noopener');
  log('[YouTube] Opened mobile page', YOUTUBE_MOBILE_URL);
}

function initControls() {
  logLifecycle('initControls:start', { defaultTextLength: DEFAULT_TEXT.length });
  if (elements.textInput) {
    elements.textInput.value = DEFAULT_TEXT;
  }
  if (elements.pitchRange) {
    elements.pitchRange.value = state.selectedPitch;
  }
  if (elements.pitchValue) {
    elements.pitchValue.textContent = state.selectedPitch.toFixed(2);
  }
  if (elements.logPanel) {
    elements.logPanel.hidden = true;
    elements.logPanel.setAttribute('hidden', '');
  }
  if (elements.toggleLogsButton) {
    elements.toggleLogsButton.textContent = 'Журнал';
  }
  populateSelect(
    elements.rateSelect,
    RATE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    state.selectedRate
  );
  rebuildEngineOptions();
  populateSelect(elements.languageSelect, state.languageOptions, state.selectedLanguage);
  rebuildVoiceOptions();
  updateStats();
  updateSpeakButton();
  logLifecycle('initControls:prepared', {
    provider: state.provider,
    engine: state.engineId,
    voices: state.voices.length,
  });
  log('[Init] Controls wired', {
    provider: state.provider,
    engine: state.engineId,
    voices: state.voices.length,
  });
}

function initEvents() {
  logLifecycle('initEvents:start');
  if (elements.speakButton) {
    elements.speakButton.addEventListener('click', speak);
  }
  if (elements.shareButton) {
    elements.shareButton.addEventListener('click', handleShare);
  }
  if (elements.settingsButton) {
    elements.settingsButton.addEventListener('click', handleSettings);
  }
  if (elements.openUrlButton) {
    elements.openUrlButton.addEventListener('click', () => openYoutubeEmbed((elements.youtubeUrl ? elements.youtubeUrl.value : '')));
  }
  if (elements.closeYoutubeButton) {
    elements.closeYoutubeButton.addEventListener('click', closeYoutubeEmbed);
  }
  if (elements.openYoutubeButton) {
    elements.openYoutubeButton.addEventListener('click', handleOpenYoutube);
  }
  if (elements.toggleLogsButton) {
    elements.toggleLogsButton.addEventListener('click', () => {
      logLifecycle('ui:toggleLogsButton:click', {
        currentlyVisible: elements.logPanel ? !elements.logPanel.hidden : null,
      });
      toggleLogs(undefined, 'header-toggle-button');
    });
  }
  if (elements.closeLogsButton) {
    elements.closeLogsButton.addEventListener('click', () => {
      logLifecycle('ui:closeLogsButton:click', {
        currentlyVisible: elements.logPanel ? !elements.logPanel.hidden : null,
      });
      toggleLogs(false, 'panel-close-button');
    });
  }
  if (elements.copyLogsButton) {
    elements.copyLogsButton.addEventListener('click', copyLogs);
  }
  if (elements.clearLogsButton) {
    elements.clearLogsButton.addEventListener('click', () => {
      clearLogs('panel-button');
      showToast('Журнал очищен');
    });
  }
  if (elements.engineSelect) {
    elements.engineSelect.addEventListener('change', handleEngineChange);
  }
  if (elements.languageSelect) {
    elements.languageSelect.addEventListener('change', handleLanguageChange);
  }
  if (elements.voiceSelect) {
    elements.voiceSelect.addEventListener('change', handleVoiceChange);
  }
  if (elements.rateSelect) {
    elements.rateSelect.addEventListener('change', handleRateChange);
  }
  if (elements.pitchRange) {
    elements.pitchRange.addEventListener('input', handlePitchChange);
  }
  if (elements.textInput) {
    elements.textInput.addEventListener('input', (event) => {
      state.text = event.target.value;
    });
  }
  window.addEventListener('message', handleMessage);
  log('[Init] Event listeners attached');
  logLifecycle('initEvents:completed');
}

function loadVoices(attempt = 0) {
  log('[WebTTS] loadVoices attempt', { attempt });
  if (!state.webSupport || typeof window.speechSynthesis === 'undefined') {
    updateStats();
    return;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) {
    if (attempt < 10) {
      window.setTimeout(() => loadVoices(attempt + 1), 250);
      return;
    }
    log('[Voices] No voices returned after retries');
  }

  const mapped = voices
    .slice()
    .sort((a, b) => {
      const langA = a.lang || '';
      const langB = b.lang || '';
      return langA.localeCompare(langB, 'ru') || (a.name || '').localeCompare(b.name || '', 'ru');
    })
    .map((voice, index) =>
      createVoiceEntry({
        id: voice.voiceURI || `${voice.name || 'voice'}-${index}`,
        name: voice.name || `Voice ${index + 1}`,
        lang: voice.lang || '',
        provider: 'web',
        voice,
      })
    );

  state.webVoices = mapped;
  state.voicesLoaded = true;

  if (state.provider === 'web') {
    state.voices = listVoicesForProvider('web');
    ensureVoiceSelection();
    rebuildLanguageOptions();
    rebuildVoiceOptions();
    updateStats();
  }

  if (state.controlsLocked && mapped.length > 0) {
    setControlsLocked(false);
  }

  log('[WebTTS] Loaded voices', { count: mapped.length, voices: mapped.map((voice) => ({ id: voice.id, name: voice.name, lang: voice.lang })).slice(0, 5) });
  logEngineState('loadVoices');
  tryApplyPendingSettings();
}

function initFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const settings = { ...parseParams(search), ...parseParams(hashParams) };
  if (Object.keys(settings).length > 0) {
    applySettings(settings, 'query');
  }
  if (search.get('youtube')) {
    openYoutubeEmbed(search.get('youtube'));
  }
}

function exposeBridge() {
  window.Mask2077Site = {
    applySettings: (settings) => applySettings(settings, 'Mask2077Site.applySettings'),
    log: (message, payload) => log(`[Bridge] ${message}`, payload),
    speak,
    cancel: cancelSpeech,
    getState: () => ({
      voicesLoaded: state.voicesLoaded,
      voice: state.selectedVoiceId,
      language: state.selectedLanguage,
      rate: state.selectedRate,
      pitch: state.selectedPitch,
      engine: state.engineId,
      usingNative: state.usingNative,
    }),
  };
}

function init() {
  logLifecycle('init:start', { support: state.support, provider: state.provider });
  initControls();
  logLifecycle('init:controls-ready');
  initEvents();
  logLifecycle('init:events-ready');
  exposeBridge();
  logLifecycle('init:bridge-exposed');
  initFromUrl();
  logLifecycle('init:url-config-applied');

  if (!state.support) {
    setControlsLocked(true);
    updateStats();
    log('[Init] Speech synthesis not supported');
    logLifecycle('init:no-support');
  }

  if (state.webSupport) {
    loadVoices();
    if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        logLifecycle('voiceschanged:event');
        loadVoices();
      });
    }
    log('[Init] Web TTS console ready');
  } else {
    updateStats();
    log('[Init] Awaiting native TTS engines');
  }

  logLifecycle('init:bootstrap-native');
  void bootstrapNative();
  logLifecycle('init:completed', {
    usingNative: state.usingNative,
    voicesLoaded: state.voicesLoaded,
    nativeReady: state.nativeReady,
  });
}

init();
















