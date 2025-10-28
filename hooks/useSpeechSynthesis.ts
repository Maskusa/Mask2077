import { useState, useEffect, useCallback, useRef } from 'react';
import type { VoiceProfile, TTSEngine, SelectOption } from '../types';
import {
  NativeTTS,
  isNativePlatformAvailable,
  type NativeVoice,
  type NativeEngine,
} from '../native/nativeTTS';
import { useLogContext } from '../context/LogContext';
import { normalizeLanguageCode, formatLanguageLabel } from '../constants/languages';

const UNKNOWN_LANGUAGE = 'unknown';

interface ResolvedLanguage {
  code: string;
  label: string;
  localeRaw: string;
  info?: ReturnType<typeof normalizeLanguageCode>;
}

const resolveLanguage = (raw?: string | null): ResolvedLanguage => {
  const localeRaw = raw ?? '';
  const info = normalizeLanguageCode(localeRaw);
  const sanitized = localeRaw.replace(/[@]/g, '-').replace(/_/g, '-').trim().toLowerCase();
  const primary = sanitized.split('-')[0] || sanitized;
  const code = info?.iso2 ?? (primary || (localeRaw ? localeRaw.trim().toLowerCase() : UNKNOWN_LANGUAGE));
  const label = formatLanguageLabel(info, localeRaw || code.toUpperCase());
  return { code, label, localeRaw: localeRaw || code, info: info ?? undefined };
};

const mapWebVoice = (voice: SpeechSynthesisVoice, index: number): VoiceProfile => {
  const language = resolveLanguage(voice.lang || voice.voiceURI);
  return {
    id: `web-${voice.voiceURI}-${index}`,
    name: voice.name,
    localeRaw: language.localeRaw,
    languageCode: language.code,
    languageLabel: language.label,
    provider: 'web',
    voice,
    languageInfo: language.info,
  };
};

const mapNativeVoice = (voice: NativeVoice, index: number): VoiceProfile => {
  const language = resolveLanguage(voice.locale);
  return {
    id: `native-${voice.id}-${index}`,
    name: voice.name || voice.id,
    localeRaw: language.localeRaw,
    languageCode: language.code,
    languageLabel: language.label,
    provider: 'native',
    nativeId: voice.id,
    languageInfo: language.info,
  };
};

export interface SpeechSynthesisHook {
  supported: boolean;
  supportCheckReady: boolean;
  speaking: boolean;
  voices: VoiceProfile[];
  engines: TTSEngine[];
  selectedEngineId: string;
  languageOptions: SelectOption[];
  selectedLanguage: string;
  usingNative: boolean;
  speak: (text: string, voice: VoiceProfile | null, rate: number, pitch: number) => Promise<void> | void;
  cancel: () => Promise<void> | void;
  selectEngine: (engineId: string) => Promise<void>;
  selectLanguage: (lang: string) => void;
  synthesizeToFile?: (
    text: string,
    voice: VoiceProfile | null,
    rate: number,
    pitch: number
  ) => Promise<{ uri: string; path: string }>;
  openSettings?: () => Promise<void>;
}

export const useSpeechSynthesis = (): SpeechSynthesisHook => {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [engines, setEngines] = useState<TTSEngine[]>([]);
  const [selectedEngineId, setSelectedEngineId] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [languageOptions, setLanguageOptions] = useState<SelectOption[]>([{ value: 'all', label: 'All languages' }]);
  const [availableLanguageCodes, setAvailableLanguageCodes] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [supportCheckReady, setSupportCheckReady] = useState(false);
  const [usingNative, setUsingNative] = useState(false);
  const voicesRef = useRef<VoiceProfile[]>([]);
  const nativeVoiceRetryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeBridgeRetryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeLogSubscription = useRef<{ remove: () => void } | null>(null);
  const nativeInitializationRef = useRef(false);
  const lastNativeVoiceSignatureRef = useRef<string | null>(null);
  const nativeVoiceLoadState = useRef<'idle' | 'loading' | 'loaded'>('idle');
  const voiceSyncSignatureRef = useRef<string | null>(null);
  const engineSyncSignatureRef = useRef<string | null>(null);
  const languageSyncSignatureRef = useRef<string | null>(null);
  const availableLanguageCodesRef = useRef<string[]>([]);
  const selectedLanguageRef = useRef<string>('all');
  const { addLog } = useLogContext();

  const recomputeLanguageOptions = useCallback(
    (voiceList: VoiceProfile[], extras: string[]) => {
      const map = new Map<string, string>();
      extras.forEach((raw) => {
        const resolved = resolveLanguage(raw);
        map.set(resolved.code, resolved.label);
      });
      voiceList.forEach((voice) => {
        map.set(voice.languageCode, voice.languageLabel);
      });
      const sorted = Array.from(map.entries()).sort((a, b) =>
        a[1].localeCompare(b[1], undefined, { sensitivity: 'base' })
      );
      const options: SelectOption[] = [{ value: 'all', label: 'All languages' }];
      sorted.forEach(([code, label]) => {
        if (code !== UNKNOWN_LANGUAGE) {
          options.push({ value: code, label });
        }
      });
      setLanguageOptions(options);
    },
    []
  );

  const applyVoiceList = useCallback(
    (voiceList: VoiceProfile[], extras?: string[]) => {
      voicesRef.current = voiceList;
      setVoices(voiceList);
      recomputeLanguageOptions(voiceList, extras ?? availableLanguageCodesRef.current);
    },
    [recomputeLanguageOptions]
  );

  const checkNativeAvailability = useCallback(async (): Promise<{ available: boolean; retry: boolean }> => {
    const isOverlayBridgePresent = () =>
      typeof window !== 'undefined' &&
      (Boolean((window as unknown as { NativeOverlayBridge?: unknown }).NativeOverlayBridge) ||
        Boolean((window as Record<string, unknown>).__nativeOverlayRuntime));

    if (!NativeTTS) {
      addLog('[NativeTTS] Plugin bridge unavailable');
      return { available: false, retry: isOverlayBridgePresent() };
    }

    if (isNativePlatformAvailable()) {
      addLog('[Support] Capacitor native platform detected');
      return { available: true, retry: false };
    }

    try {
      const result = await NativeTTS.isAvailable();
      const available = Boolean(result?.available);
      addLog(`[NativeTTS] isAvailable resolved: ${available}`);
      if (available) {
        return { available: true, retry: false };
      }
      return { available: false, retry: isOverlayBridgePresent() };
    } catch (error) {
      console.warn('[NativeTTS] isAvailable error', error);
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[NativeTTS] isAvailable error: ${message}`);
      const lowerMessage = message.toLowerCase();
      const retryable =
        isOverlayBridgePresent() &&
        (lowerMessage.includes('not implemented on web') ||
          lowerMessage.includes('nativepromise') ||
          lowerMessage.includes('unavailable') ||
          lowerMessage.includes('undefined'));
      return { available: false, retry: retryable };
    }
  }, [addLog]);

  const populateWebVoices = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    const newVoices = window.speechSynthesis.getVoices();
    const mapped = newVoices.map((voice, index) => mapWebVoice(voice, index));
    applyVoiceList(mapped, []);
  }, [applyVoiceList]);

  const attachNativeListener = useCallback(() => {
    if (!NativeTTS) {
      return () => undefined;
    }
    let isSubscribed = true;
    let subscription: { remove: () => void } | null = null;

    (async () => {
      try {
        subscription = await NativeTTS.addListener('ttsState', ({ state }) => {
          if (!isSubscribed) {
            return;
          }
          if (state === 'start') {
            setSpeaking(true);
            addLog('[NativeTTS] Playback started');
          } else {
            setSpeaking(false);
            addLog(`[NativeTTS] Playback ${state === 'done' ? 'finished' : 'error'}`);
          }
        });
      } catch (error) {
        console.warn('[NativeTTS] Failed to attach listener', error);
        addLog(`[NativeTTS] Listener error: ${(error as Error).message}`);
      }
    })();

    return () => {
      isSubscribed = false;
      subscription?.remove();
    };
  }, [addLog]);

  const loadNativeVoices = useCallback(
    (retry = 0) => {
      if (!NativeTTS) {
        return;
      }
      if (retry === 0 && nativeVoiceLoadState.current === 'loading') {
        addLog('[NativeTTS] loadNativeVoices skipped (in progress)');
        return;
      }
      if (retry === 0 && nativeVoiceLoadState.current === 'loaded') {
        addLog('[NativeTTS] loadNativeVoices skipped (already loaded)');
        return;
      }
      nativeVoiceLoadState.current = 'loading';
      addLog(`[NativeTTS] loadNativeVoices invoked. retry=${retry}`);
      NativeTTS.getVoices()
        .then(({ voices: nativeVoices }) => {
          addLog(`[NativeTTS] getVoices resolved. count=${nativeVoices?.length ?? 0}`);
          if (!nativeVoices || nativeVoices.length === 0) {
            addLog('[NativeTTS] No voices reported, using default locale');
            const fallbackLanguage = resolveLanguage(undefined);
            applyVoiceList([
              {
                id: 'native-default',
                name: 'System voice',
                localeRaw: fallbackLanguage.localeRaw,
                languageCode: fallbackLanguage.code,
                languageLabel: fallbackLanguage.label,
                provider: 'native',
              },
            ]);
            nativeVoiceLoadState.current = 'loaded';
            return;
          }
          const sortedVoices = [...nativeVoices].sort((a, b) => a.id.localeCompare(b.id));
          const signature = sortedVoices.map((voice) => voice.id).join('|');
          if (lastNativeVoiceSignatureRef.current === signature) {
            addLog('[NativeTTS] Voice signature unchanged; skipping update');
            return;
          }
          lastNativeVoiceSignatureRef.current = signature;
          const mapped = sortedVoices.map((voice, index) => mapNativeVoice(voice, index));
          applyVoiceList(mapped);
          addLog(`[NativeTTS] Received ${nativeVoices.length} voices`);
          nativeVoiceLoadState.current = 'loaded';
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          addLog(`[NativeTTS] getVoices error: ${message}`);
          if (message === 'not_ready' && retry < 5) {
            nativeVoiceRetryTimeout.current = setTimeout(() => loadNativeVoices(retry + 1), 200);
            return;
          }
          if (retry < 3) {
            nativeVoiceRetryTimeout.current = setTimeout(() => loadNativeVoices(retry + 1), 300);
          } else {
            console.warn('[NativeTTS] Unable to fetch voices', error);
            addLog(`[NativeTTS] Fetch voices failed: ${message}`);
          }
          nativeVoiceLoadState.current = 'idle';
        });
    },
    [addLog, applyVoiceList]
  );

  const refreshAvailableLanguages = useCallback(() => {
    if (!NativeTTS) {
      return;
    }
    NativeTTS.getAvailableLanguages()
      .then(({ languages, defaultLanguage }) => {
        const unique = Array.from(new Set(languages));
        setAvailableLanguageCodes(unique);
        recomputeLanguageOptions(voicesRef.current, unique);
        if (selectedLanguageRef.current === 'all') {
          const resolved = resolveLanguage(defaultLanguage);
          if (resolved.code && resolved.code !== UNKNOWN_LANGUAGE) {
            setSelectedLanguage((prev) => {
              if (prev !== 'all') {
                return prev;
              }
              return resolved.code;
            });
          }
        }
      })
      .catch((error) => {
        console.warn('[NativeTTS] Unable to fetch languages', error);
        addLog(`[NativeTTS] Fetch languages failed: ${(error as Error).message}`);
      });
  }, [addLog, recomputeLanguageOptions]);

  const loadNativeEngines = useCallback(() => {
    if (!NativeTTS) {
      return;
    }
    addLog('[NativeTTS] loadNativeEngines invoked');
    NativeTTS.getEngines()
      .then(({ engines: nativeEngines, currentEngine }) => {
        const mapped = (nativeEngines || []).map((engine: NativeEngine) => ({
          id: engine.id,
          label: engine.label || engine.id,
        }));
        setEngines(mapped);
        if (currentEngine) {
          setSelectedEngineId(currentEngine);
        } else if (mapped.length > 0) {
          setSelectedEngineId(mapped[0].id);
        }
        addLog(
          `[NativeTTS] getEngines result. current=${currentEngine ?? 'n/a'} engines=[${mapped
            .map((engine) => engine.id)
            .join(', ')}]`
        );
      })
      .catch((error) => {
        console.warn('[NativeTTS] Unable to fetch engines', error);
        addLog(`[NativeTTS] Fetch engines failed: ${(error as Error).message}`);
      });
  }, [addLog]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    let supportedTimer: ReturnType<typeof setTimeout> | null = null;
    let bridgeRetryAttempts = 0;

    const clearBridgeRetry = () => {
      if (nativeBridgeRetryTimeout.current) {
        clearTimeout(nativeBridgeRetryTimeout.current);
        nativeBridgeRetryTimeout.current = null;
      }
    };

    const scheduleBridgeRetry = (delay: number) => {
      clearBridgeRetry();
      nativeBridgeRetryTimeout.current = setTimeout(() => {
        if (!cancelled) {
          void bootstrap();
        }
      }, delay);
    };

    const activateNative = () => {
      setUsingNative(true);
      supportedTimer = setTimeout(() => {
        if (!cancelled) {
          setSupported(true);
          setSupportCheckReady(true);
        }
      }, 2000);

      if (!nativeInitializationRef.current) {
        nativeInitializationRef.current = true;
        addLog('[NativeTTS] native init start');
        addLog('[Support] Requesting native engines from client');
        loadNativeEngines();
        refreshAvailableLanguages();
        if (nativeVoiceLoadState.current !== 'loaded') {
          loadNativeVoices();
        }
      } else {
        addLog('[NativeTTS] native init skipped (already initialized)');
      }

      const detach = attachNativeListener();
      cleanup = () => {
        detach?.();
        nativeInitializationRef.current = false;
      };
      clearBridgeRetry();
    };

    const activateWeb = () => {
      setUsingNative(false);
      clearBridgeRetry();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        addLog('[Support] Using Web Speech API voices');
        populateWebVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
          window.speechSynthesis.onvoiceschanged = populateWebVoices;
        }
        supportedTimer = setTimeout(() => {
          if (!cancelled) {
            setSupported(true);
            setSupportCheckReady(true);
          }
        }, 2000);
        cleanup = () => {
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = null;
          }
        };
      } else {
        addLog('[Support] Web speech synthesis unavailable');
        setSupported(false);
        setSupportCheckReady(true);
        cleanup = null;
      }
    };

    const bootstrap = async () => {
      addLog('[Support] Checking TTS capabilities');
      const { available, retry } = await checkNativeAvailability();
      if (cancelled) {
        return;
      }
      if (available) {
        addLog('[Support] Using native TTS engines');
        activateNative();
        return;
      }
      if (retry && bridgeRetryAttempts < 5) {
        bridgeRetryAttempts += 1;
        const delay = Math.min(2000, 300 * 2 ** (bridgeRetryAttempts - 1));
        addLog(`[Support] Native bridge not ready, retrying in ${delay}ms (attempt ${bridgeRetryAttempts})`);
        scheduleBridgeRetry(delay);
        return;
      }
      addLog('[Support] Native engines unavailable, falling back to web');
      activateWeb();
      if (!(typeof window !== 'undefined' && 'speechSynthesis' in window)) {
        addLog('[Support] No speech synthesis engines available');
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      cleanup?.();
      if (nativeVoiceRetryTimeout.current) {
        clearTimeout(nativeVoiceRetryTimeout.current);
        nativeVoiceRetryTimeout.current = null;
      }
      if (supportedTimer) {
        clearTimeout(supportedTimer);
      }
      clearBridgeRetry();
    };
  }, [
    attachNativeListener,
    checkNativeAvailability,
    loadNativeEngines,
    loadNativeVoices,
    populateWebVoices,
    refreshAvailableLanguages,
    addLog,
  ]);

  useEffect(() => {
    if (!usingNative || !NativeTTS) {
      nativeLogSubscription.current?.remove();
      nativeLogSubscription.current = null;
      return;
    }
    let isSubscribed = true;
    (async () => {
      try {
        nativeLogSubscription.current = await NativeTTS.addListener('log', ({ message }) => {
          if (!isSubscribed) {
            return;
          }
          addLog(`[NativeTTS][native] ${message}`);
        });
        addLog('[NativeTTS] Native log listener attached');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addLog(`[NativeTTS] Failed to attach log listener: ${msg}`);
      }
    })();
    return () => {
      isSubscribed = false;
      nativeLogSubscription.current?.remove();
      nativeLogSubscription.current = null;
      addLog('[NativeTTS] Native log listener detached');
    };
  }, [usingNative, addLog]);

  useEffect(() => {
    const availableCodes = languageOptions.map((option) => String(option.value));
    if (!availableCodes.includes(selectedLanguage)) {
      setSelectedLanguage(availableCodes.includes('all') ? 'all' : availableCodes[0] ?? 'all');
    }
  }, [languageOptions, selectedLanguage]);

  useEffect(() => {
    const signature = voices.map((voice) => voice.id).join('|');
    if (voiceSyncSignatureRef.current === signature) {
      return;
    }
    voiceSyncSignatureRef.current = signature;
    addLog(`[Sync] Voices synchronized (${voices.length})`);
  }, [voices, addLog]);

  useEffect(() => {
    const signature = engines.map((engine) => engine.id).join('|');
    if (engineSyncSignatureRef.current === signature) {
      return;
    }
    engineSyncSignatureRef.current = signature;
    addLog(`[Sync] Engines synchronized (${engines.length})`);
  }, [engines, addLog]);

  useEffect(() => {
    const signature = languageOptions.map((option) => String(option.value)).join('|');
    if (languageSyncSignatureRef.current === signature) {
      return;
    }
    languageSyncSignatureRef.current = signature;
    addLog(`[Sync] Languages synchronized (${languageOptions.length})`);
  }, [languageOptions, addLog]);

  const speak = useCallback(
    async (text: string, voice: VoiceProfile | null, rate: number, pitch: number) => {
      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }

      if (usingNative && NativeTTS) {
        if (!voice?.nativeId) {
          addLog('[NativeTTS] No native voice selected');
          return;
        }
        setSpeaking(true);
        try {
          await NativeTTS.speak({
            text: trimmedText,
            voiceId: voice.nativeId,
            rate,
            pitch,
          });
          addLog(`[App] Native speak triggered. chars=${trimmedText.length}`);
        } catch (error) {
          console.warn('[NativeTTS] speak failed', error);
          addLog(`[NativeTTS] speak failed: ${(error as Error).message}`);
          setSpeaking(false);
        }
        return;
      }

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmedText);
      utterance.onstart = () => setSpeaking(true);
      const resetSpeaking = () => setSpeaking(false);
      utterance.onend = resetSpeaking;
      utterance.onerror = resetSpeaking;

      if (voice?.voice) {
        utterance.voice = voice.voice;
      }
      utterance.rate = rate;

      window.speechSynthesis.speak(utterance);
      addLog(`[App] Web speak triggered. chars=${trimmedText.length}`);
    },
    [usingNative, addLog]
  );

  const cancel = useCallback(() => {
    if (usingNative && NativeTTS) {
      NativeTTS.stop().catch((error) => {
        console.warn('[NativeTTS] stop failed', error);
        addLog(`[NativeTTS] stop failed: ${(error as Error).message}`);
      });
      addLog('[App] Stop requested');
      setSpeaking(false);
      return;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      addLog('[App] Web speech cancelled');
      setSpeaking(false);
    }
  }, [usingNative, addLog]);

  const selectEngine = useCallback(
    async (engineId: string) => {
      if (!engineId || !usingNative || !NativeTTS) {
        return;
      }
      await NativeTTS.selectEngine({ engineId });
      setSelectedEngineId(engineId);
      setSelectedLanguage('all');
      lastNativeVoiceSignatureRef.current = null;
      nativeVoiceLoadState.current = 'idle';
      loadNativeVoices(0);
      refreshAvailableLanguages();
      addLog(`[App] Engine selected: ${engineId}`);
    },
    [usingNative, loadNativeVoices, refreshAvailableLanguages, addLog]
  );

  const selectLanguage = useCallback(
    (lang: string) => {
      setSelectedLanguage(lang);
      addLog(`[App] Language filter: ${lang}`);
    },
    [addLog]
  );

  const openSettings = useCallback(() => {
    if (usingNative && NativeTTS) {
      return NativeTTS.openSettings().catch((error) => {
        console.warn('[NativeTTS] openSettings failed', error);
        addLog(`[NativeTTS] openSettings failed: ${(error as Error).message}`);
      });
    }
    return Promise.resolve();
  }, [usingNative, addLog]);

  const synthesizeToFile = useCallback(
    async (text: string, voice: VoiceProfile | null, rate: number, pitch: number) => {
      if (!usingNative || !NativeTTS) {
        throw new Error('Native TTS not available');
      }
      const trimmedText = text.trim();
      if (!trimmedText) {
        throw new Error('Text is empty');
      }
      if (!voice?.nativeId) {
        throw new Error('No native voice selected');
      }
      try {
        const result = await NativeTTS.synthesizeToFile({
          text: trimmedText,
          voiceId: voice.nativeId,
          rate,
          pitch,
        });
        addLog(`[App] Audio file created at ${result.path}`);
        return result;
      } catch (error) {
        addLog(`[NativeTTS] synthesizeToFile failed: ${(error as Error).message}`);
        throw error;
      }
    },
    [usingNative, addLog]
  );

  useEffect(() => () => {
    if (nativeVoiceRetryTimeout.current) {
      clearTimeout(nativeVoiceRetryTimeout.current);
    }
  }, []);

  useEffect(() => {
    availableLanguageCodesRef.current = availableLanguageCodes;
  }, [availableLanguageCodes]);

  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  return {
    supported,
    supportCheckReady,
    speaking,
    voices,
    engines,
    selectedEngineId,
    languageOptions,
    selectedLanguage,
    usingNative,
    speak,
    cancel,
    selectEngine,
    selectLanguage,
    synthesizeToFile: usingNative && NativeTTS ? synthesizeToFile : undefined,
    openSettings: usingNative && NativeTTS ? openSettings : undefined,
  };
};







