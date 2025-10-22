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
  const nativeLogSubscription = useRef<{ remove: () => void } | null>(null);
  const nativeInitializationRef = useRef(false);
  const lastNativeVoiceSignatureRef = useRef<string | null>(null);
  const nativeVoiceLoadState = useRef<'idle' | 'loading' | 'loaded'>('idle');
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
      recomputeLanguageOptions(voiceList, extras ?? availableLanguageCodes);
    },
    [availableLanguageCodes, recomputeLanguageOptions]
  );

  const populateWebVoices = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    const newVoices = window.speechSynthesis.getVoices();
    const mapped = newVoices.map((voice, index) => mapWebVoice(voice, index));
    applyVoiceList(mapped, []);
  }, [applyVoiceList]);

  const attachNativeListener = useCallback(() => {
    if (!NativeTTS || !isNativePlatformAvailable()) {
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
        if (selectedLanguage === 'all') {
          const resolved = resolveLanguage(defaultLanguage);
          if (resolved.code && resolved.code !== UNKNOWN_LANGUAGE) {
            setSelectedLanguage(resolved.code);
          }
        }
      })
      .catch((error) => {
        console.warn('[NativeTTS] Unable to fetch languages', error);
        addLog(`[NativeTTS] Fetch languages failed: ${(error as Error).message}`);
      });
  }, [addLog, recomputeLanguageOptions, selectedLanguage]);

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
    const preferNative = isNativePlatformAvailable() && Boolean(NativeTTS);
    let supportedTimer: ReturnType<typeof setTimeout> | null = null;

    if (preferNative) {
      setUsingNative(true);
      supportedTimer = setTimeout(() => {
        setSupported(true);
        setSupportCheckReady(true);
      }, 2000);
      if (!nativeInitializationRef.current) {
        nativeInitializationRef.current = true;
        addLog('[NativeTTS] native init start');
        loadNativeEngines();
        refreshAvailableLanguages();
        if (nativeVoiceLoadState.current !== 'loaded') {
          loadNativeVoices();
        }
      } else {
        addLog('[NativeTTS] native init skipped (already initialized)');
      }
      const detach = attachNativeListener();
      NativeTTS?.isAvailable()
        .catch((error) => {
          console.warn('[NativeTTS] Availability check failed', error);
          addLog(`[NativeTTS] Availability check failed: ${(error as Error).message}`);
        });
      return () => {
        nativeInitializationRef.current = false;
        detach?.();
        if (nativeVoiceRetryTimeout.current) {
          clearTimeout(nativeVoiceRetryTimeout.current);
        }
        if (supportedTimer) {
          clearTimeout(supportedTimer);
        }
      };
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setUsingNative(false);
      supportedTimer = setTimeout(() => {
        setSupported(true);
        setSupportCheckReady(true);
      }, 2000);
      populateWebVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = populateWebVoices;
      }
      return () => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.onvoiceschanged = null;
        }
        if (supportedTimer) {
          clearTimeout(supportedTimer);
        }
      };
    }

    setSupportCheckReady(true);
    setSupported(false);
    nativeInitializationRef.current = false;
    return () => {
      if (supportedTimer) {
        clearTimeout(supportedTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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







