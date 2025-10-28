import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Capacitor, type PermissionState, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  AdMob,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { useLogContext } from './context/LogContext';
import { SPEECH_RATES, DEFAULT_TEXT } from './constants';
import Select from './components/Select';
import Button from './components/Button';
import TextArea from './components/TextArea';
import LogOverlay from './components/LogOverlay';
import WebExperience from './components/WebExperience';
import type { SelectOption, VoiceProfile } from './types';
import { NativeTTS } from './native/nativeTTS';
import { NativeUtilities } from './native/nativeUtilities';
import { NativePurchases } from './native/nativePurchases';
import {
  getFirebaseDatabase,
  getFirebaseAuth,
  logFirebaseEvent,
  signInAnonymouslyIfNeeded,
} from './firebase';
import { get, ref } from 'firebase/database';
import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { WEB_PORTAL_URL } from './constants/web';

type Screen = 'home' | 'tts' | 'site' | 'ads' | 'purchases' | 'fonts' | 'file' | 'reminders';

interface FontOption {
  family: string;
}

interface Reminder {
  id: string;
  durationMs: number;
  loop: boolean;
  createdAt: number;
  nextTriggerAt: number;
  lastTriggeredAt: number | null;
  status: 'scheduled' | 'completed';
  notificationId: number | null;
}

const BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';
const REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
const SHARE_APP_TEXT =
  'Check out this game: https://play.google.com/store/apps/details?id=com.subtit.player.';
const SHARE_APP_URL = 'https://play.google.com/store/apps/details?id=com.subtit.player';
const STORE_REVIEW_URL = `${SHARE_APP_URL}&showAllReviews=true`;
const YOUTUBE_MOBILE_URL = 'https://m.youtube.com/';
const YOUTUBE_EMBED_BASE_URL = 'https://www.youtube.com/embed/';
const FONT_FALLBACK_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_PREVIEW_PARAGRAPH =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
const FONT_SAMPLE_TEXT = 'Пример текста со шрифтом';
const FONT_PROBE_LIST: readonly string[] = [
  'Arial',
  'Comic Sans MS',
  'Courier New',
  'Gabriola',
  'Georgia',
  'Impact',
  'Inter',
  'Montserrat',
  'Noto Sans',
  'Open Sans',
  'Palatino Linotype',
  'Roboto',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];
const FONT_FALLBACK_LIST: readonly string[] = [
  'Arial',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Impact',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Verdana',
];

const REMINDER_DEFAULT_TIMER_VALUE = '00:00:10';
const REMINDER_NOTIFICATION_TITLE = '\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435';
const REMINDER_NOTIFICATION_BODY = '\u0422\u0430\u0439\u043c\u0435\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d.';
const REMINDERS_STORAGE_KEY = 'mask2077.reminders';

const parseReminderDuration = (value: string): number | null => {
  const parts = value.split(':');

  if (parts.length !== 3) {
    return null;
  }

  const [daysPart, hoursPart, minutesPart] = parts.map((part) => part.trim());
  const days = Number(daysPart);
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);

  if (
    Number.isNaN(days) ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    days < 0 ||
    hours < 0 ||
    minutes < 0 ||
    hours > 23 ||
    minutes > 59
  ) {
    return null;
  }

  const totalMinutes = days * 24 * 60 + hours * 60 + minutes;
  if (totalMinutes <= 0) {
    return null;
  }

  return totalMinutes * 60 * 1000;
};

const formatReminderDuration = (milliseconds: number): string => {
  const totalMinutes = Math.floor(milliseconds / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = totalMinutes - days * 24 * 60 - hours * 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} \u0434\u043d.`);
  }
  if (hours > 0) {
    parts.push(`${hours} \u0447.`);
  }
  parts.push(`${minutes} \u043c\u0438\u043d.`);

  return parts.join(' ');
};

const formatReminderCountdown = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds - days * 24 * 3600) / 3600);
  const minutes = Math.floor((totalSeconds - days * 24 * 3600 - hours * 3600) / 60);
  const seconds = totalSeconds - days * 24 * 3600 - hours * 3600 - minutes * 60;

  const pad = (value: number) => value.toString().padStart(2, '0');

  return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const normalizePermissionState = (state: PermissionState | undefined): PermissionState => {
  if (state === 'prompt-with-rationale' || state === undefined) {
    return 'prompt';
  }
  return state;
};

const composeFontFamily = (family: string | null): string | undefined => {
  if (!family) {
    return undefined;
  }
  const sanitized = family.replace(/['"]/g, '');
  return `'${sanitized}', ${FONT_FALLBACK_STACK}`;
};

const buildVoiceLabel = (voice: VoiceProfile): string => {
  const provider = voice.provider === 'native' ? 'native' : 'web';
  return `${voice.name} Â· ${voice.languageLabel} Â· ${provider}`;
};

const toNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 1 : parsed;
};

const buildYoutubeEmbedUrl = (rawValue: string): string | null => {
  const input = rawValue.trim();
  if (!input) {
    return null;
  }

  const createEmbedUrl = (videoId: string, params?: URLSearchParams) => {
    if (!videoId) {
      return null;
    }
    const embedUrl = new URL(`${YOUTUBE_EMBED_BASE_URL}${videoId}`);
    if (params) {
      params.forEach((value, key) => {
        if (key.toLowerCase() !== 'v') {
          embedUrl.searchParams.append(key, value);
        }
      });
    }
    return embedUrl.toString();
  };

  const ensureProtocol = (value: string) => {
    if (/^[a-zA-Z]+:\/\//.test(value)) {
      return value;
    }
    if (value.includes('.')) {
      return `https://${value}`;
    }
    return value;
  };

  const attemptParse = (candidate: string) => {
    try {
      return new URL(candidate);
    } catch {
      return null;
    }
  };

  const firstPass = attemptParse(ensureProtocol(input));
  if (firstPass) {
    const host = firstPass.hostname.toLowerCase();
    const pathSegments = firstPass.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const [videoId] = pathSegments;
      return createEmbedUrl(videoId ?? '', firstPass.searchParams);
    }

    if (host.endsWith('youtube.com')) {
      const [firstSegment, secondSegment] = pathSegments;

      if (firstSegment === 'watch') {
        const videoId = firstPass.searchParams.get('v');
        firstPass.searchParams.delete('v');
        return createEmbedUrl(videoId ?? '', firstPass.searchParams);
      }

      if (firstSegment === 'shorts' || firstSegment === 'live') {
        return createEmbedUrl(secondSegment ?? '', firstPass.searchParams);
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
};

const App: React.FC = () => {
  const {
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
    synthesizeToFile,
    openSettings,
  } = useSpeechSynthesis();
  const { logs, addLog, clearLogs } = useLogContext();

  const [screen, setScreen] = useState<Screen>('home');
  const [text, setText] = useState<string>(DEFAULT_TEXT);
  const [pitch, setPitch] = useState<number>(1);
  const [rate, setRate] = useState<number>(1);
  const [voiceId, setVoiceId] = useState<string>('');
  const [showLogs, setShowLogs] = useState(false);
  const [availableFonts, setAvailableFonts] = useState<FontOption[]>([]);
  const [fontDetectionCompleted, setFontDetectionCompleted] = useState(false);
  const [selectedFontFamily, setSelectedFontFamily] = useState<string | null>(null);
  const [fontPreviewValue, setFontPreviewValue] = useState<string>(FONT_PREVIEW_PARAGRAPH);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [webSiteUrl, setWebSiteUrl] = useState<string>(WEB_PORTAL_URL);
  const [webSiteContext, setWebSiteContext] = useState<'generic' | 'youtube'>('generic');
  const [youtubeUrlInput, setYoutubeUrlInput] = useState<string>('');
  const [youtubeUrlError, setYoutubeUrlError] = useState<string | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [interstitialReady, setInterstitialReady] = useState(false);
  const [interstitialLoading, setInterstitialLoading] = useState(false);
  const [rewardReady, setRewardReady] = useState(false);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [adMobReady, setAdMobReady] = useState(false);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [reminderInputValue, setReminderInputValue] = useState<string>(REMINDER_DEFAULT_TIMER_VALUE);
  const [reminderLoopEnabled, setReminderLoopEnabled] = useState<boolean>(false);
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reminderTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const remindersRef = useRef<Reminder[]>([]);
  const remindersLoadedRef = useRef<boolean>(false);
  const reminderLastTriggerRef = useRef<Map<string, number>>(new Map());
  const localNotificationPermission = useRef<PermissionState>('prompt');
  const adSubscriptions = useRef<PluginListenerHandle[]>([]);

  const trackHomeButton = useCallback(
    (buttonId: string) => {
      const webEvent = `home_button_${buttonId}`;
      void logFirebaseEvent(webEvent);

      if (Capacitor.getPlatform() !== 'web') {
        void FirebaseAnalytics.logEvent({
          name: `home_button_click_${buttonId}`,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          addLog(`[Firebase] Native analytics failed: ${message}`);
        });
      }
    },
    [addLog]
  );

  const platformLabel = useMemo(() => {
    const platform = Capacitor.getPlatform();
    return platform === 'web' ? 'Ð±ÑÐ°ÑÐ·ÐµÑ' : platform;
  }, []);
  const isNativePlatform = useMemo(() => Capacitor.getPlatform() !== 'web', []);
  const localNotificationsSupported = useMemo(
    () => Capacitor.isPluginAvailable('LocalNotifications'),
    []
  );

  useEffect(() => {
    if (!localNotificationsSupported) {
      return;
    }

    let cancelled = false;
    const syncPermission = async () => {
      try {
        const status = await LocalNotifications.checkPermissions();
        const normalized = normalizePermissionState(status.display);
        if (!cancelled) {
          localNotificationPermission.current = normalized;
          addLog(`[Reminders] Local notification permission state: ${normalized}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Reminders] Failed to check local notification permission: ${message}`);
      }
    };

    void syncPermission();

    return () => {
      cancelled = true;
    };
  }, [addLog, localNotificationsSupported]);

  useEffect(() => {
    if (screen === 'site') {
      const presentation = webSiteContext === 'youtube' ? 'default' : 'minimal';
      addLog(`[Web] screen=site context=${webSiteContext} presentation=${presentation}`);
    }
  }, [screen, webSiteContext, addLog]);

  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const intervalId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!remindersLoadedRef.current) {
      return;
    }

    try {
      window.localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Reminders] Failed to persist reminders: ${message}`);
    }
  }, [addLog, reminders]);

  const stats = useMemo(
    () => ({
      provider: usingNative ? 'native' : 'browser',
      voicesCount: voices.length,
      enginesCount: engines.length,
    }),
    [usingNative, voices.length, engines.length]
  );

  const renderTts = () => (
    <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">TTS synth</p>
          <h1 className="text-3xl font-semibold">Ð ÐµÐ¶Ð¸Ð¼ ÑÐ¸Ð½ÑÐµÐ·Ð°</h1>
          <p className="text-sm text-slate-300">
            ÐÑÑÐ¾ÑÐ½Ð¸Ðº: {stats.provider === 'native' ? 'Ð½Ð°ÑÐ¸Ð²Ð½ÑÐ¹' : 'Ð±ÑÐ°ÑÐ·ÐµÑÐ½ÑÐ¹'} Â· {stats.voicesCount} Ð³Ð¾Ð»Ð¾ÑÐ¾Ð² Â·{' '}
            {stats.enginesCount} Ð´Ð²Ð¸Ð¶Ð¾Ðº(Ð¾Ð²)
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            ÐÐ°Ð·Ð°Ð´
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={handleShowLogs}>
            ÐÑÑÐ½Ð°Ð»
          </Button>
        </div>
      </header>

      {renderSpeechPanel()}
    </div>
  );

  const engineOptions = useMemo<SelectOption[]>(() => {
    return engines.map((engine) => ({
      value: engine.id,
      label: engine.label,
    }));
  }, [engines]);

  const filteredVoices = useMemo(() => {
    if (selectedLanguage === 'all') {
      return voices;
    }
    return voices.filter((voice) => voice.languageCode === selectedLanguage);
  }, [voices, selectedLanguage]);

  const voiceOptions = useMemo<SelectOption[]>(() => {
    return filteredVoices.map((voice) => ({
      value: voice.id,
      label: buildVoiceLabel(voice),
    }));
  }, [filteredVoices]);

  const languageSelectOptions = useMemo(() => languageOptions, [languageOptions]);

  const selectedVoice = useMemo(() => filteredVoices.find((voice) => voice.id === voiceId) ?? null, [
    filteredVoices,
    voiceId,
  ]);

  const mergedFontOptions = useMemo(() => {
    const unique = new Map<string, FontOption>();
    availableFonts.forEach((font) => {
      const key = font.family.trim().toLowerCase();
      if (!key || unique.has(key)) {
        return;
      }
      unique.set(key, font);
    });
    FONT_FALLBACK_LIST.forEach((fontName) => {
      const key = fontName.trim().toLowerCase();
      if (!unique.has(key)) {
        unique.set(key, { family: fontName });
      }
    });
    return Array.from(unique.values());
  }, [availableFonts]);

  const formattedSelectedFont = useMemo(
    () => composeFontFamily(selectedFontFamily),
    [selectedFontFamily]
  );

  const fontRows = useMemo(() => {
    const defaultRow = {
      key: 'default',
      family: null as string | null,
      label: 'System default (fallback)',
    };
    const dynamicRows = mergedFontOptions.map((font) => ({
      key: font.family,
      family: font.family,
      label: font.family,
    }));
    return [defaultRow, ...dynamicRows];
  }, [mergedFontOptions]);

  const fontPreviewText = useMemo(
    () => (fontPreviewValue.trim() ? fontPreviewValue : FONT_PREVIEW_PARAGRAPH),
    [fontPreviewValue]
  );

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      setFontDetectionCompleted(true);
      return;
    }
    let cancelled = false;
    const span = document.createElement('span');
    span.textContent = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890';
    span.style.position = 'absolute';
    span.style.left = '-9999px';
    span.style.top = '0';
    span.style.fontSize = '72px';
    span.style.fontWeight = '400';
    span.style.whiteSpace = 'nowrap';
    span.style.visibility = 'hidden';
    document.body.appendChild(span);

    const signatureFor = (fontFamily: string) => {
      span.style.fontFamily = fontFamily;
      return `${span.offsetWidth}-${span.offsetHeight}`;
    };

    const baseStacks = ['monospace', 'serif', 'sans-serif'];
    const baseSignatures = baseStacks.map(signatureFor);

    const detected = new Map<string, FontOption>();
    FONT_PROBE_LIST.forEach((fontName) => {
      const signature = signatureFor(`'${fontName}', ${baseStacks[0]}`);
      const matchesBase = baseSignatures.includes(signature);
      if (!matchesBase && !detected.has(fontName)) {
        detected.set(fontName, { family: fontName });
      }
    });

    document.body.removeChild(span);

    if (!cancelled) {
      if (detected.size === 0) {
        const fallbackDetected = new Map<string, FontOption>();
        FONT_FALLBACK_LIST.forEach((fontName) => {
          fallbackDetected.set(fontName, { family: fontName });
        });
        setAvailableFonts(Array.from(fallbackDetected.values()));
      } else {
        setAvailableFonts(Array.from(detected.values()));
      }
      setFontDetectionCompleted(true);
      addLog('[Fonts] Detection completed', { detected: detected.size });
    }

    return () => {
      cancelled = true;
      if (span.parentNode) {
        span.parentNode.removeChild(span);
      }
    };
  }, [addLog]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (!supportCheckReady) {
      setLoadingProgress(0);
      timer = setInterval(() => {
        setLoadingProgress((prev) => {
          const next = prev + Math.random() * 12 + 4;
          return next >= 95 ? 95 : next;
        });
      }, 200);
    } else {
      setLoadingProgress(100);
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [supportCheckReady]);

  useEffect(() => {
    let cancelled = false;
    const ensureAuth = async () => {
      try {
        const auth = await signInAnonymouslyIfNeeded();
        if (!cancelled && auth?.currentUser) {
          addLog(`[Firebase] Anonymous auth established (uid=${auth.currentUser.uid})`);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Firebase] Anonymous auth failed: ${message}`);
      } finally {
        if (!cancelled) {
          setFirebaseAuthReady(true);
        }
      }
    };
    ensureAuth();
    return () => {
      cancelled = true;
    };
  }, [addLog]);

  useEffect(() => {
    if (filteredVoices.length === 0) {
      setVoiceId('');
      return;
    }
    if (!voiceId || !filteredVoices.some((voice) => voice.id === voiceId)) {
      setVoiceId(filteredVoices[0].id);
    }
  }, [filteredVoices, voiceId]);

  useEffect(() => {
    if (!firebaseAuthReady) {
      return;
    }
    let cancelled = false;
    const fetchRemoteConfig = async () => {
      const auth = getFirebaseAuth();
      const uid = auth?.currentUser?.uid ?? 'unauthenticated';
      addLog(`[Firebase] Attempting to read config (uid=${uid})`);
      const db = getFirebaseDatabase();
      if (!db) {
        addLog('[Firebase] Database not configured');
        return;
      }
      try {
        const snapshot = await get(ref(db, 'config'));
        if (!snapshot.exists()) {
          if (!cancelled) {
            addLog('[Firebase] Config node not found');
          }
          return;
        }
        if (cancelled) {
          return;
        }
        const data = snapshot.val() as {
          LastVersionCode?: unknown;
          AdsBannerMode?: unknown;
        };
        addLog('[Firebase] Config snapshot received');
        const formatValue = (value: unknown): string => {
          if (value === null || value === undefined) {
            return 'N/A';
          }
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
          }
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        };
        addLog(`[Config] LastVersionCode=${formatValue(data?.LastVersionCode)}`);
        addLog(`[Config] AdsBannerMode=${formatValue(data?.AdsBannerMode)}`);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Firebase] Config load failed: ${message}`);
      }
    };
    fetchRemoteConfig();
    return () => {
      cancelled = true;
    };
  }, [addLog, firebaseAuthReady]);

  useEffect(() => {
    let cancelled = false;
    const initAdMob = async () => {
      try {
        await AdMob.initialize();
        if (!cancelled) {
          setAdMobReady(true);
          addLog('[Ads] AdMob initialized');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Ads] initialize failed: ${message}`);
      }
    };
    initAdMob();
    return () => {
      cancelled = true;
    };
  }, [addLog]);

  useEffect(() => {
    const registerListeners = async () => {
      const listeners: PluginListenerHandle[] = [];
      try {
        listeners.push(
          await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
            setBannerVisible(true);
            addLog('[Ads] Banner loaded');
          })
        );
        listeners.push(
          await AdMob.addListener(BannerAdPluginEvents.Closed, () => {
            addLog('[Ads] Banner closed');
          })
        );
        listeners.push(
          await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (info) => {
            addLog(`[Ads] Banner failed: ${JSON.stringify(info)}`);
          })
        );
        listeners.push(
          await AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => {
            setInterstitialReady(true);
            setInterstitialLoading(false);
            addLog('[Ads] Interstitial loaded');
          })
        );
        listeners.push(
          await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
            setInterstitialReady(false);
            addLog('[Ads] Interstitial dismissed');
          })
        );
        listeners.push(
          await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, (info) => {
            setInterstitialLoading(false);
            addLog(`[Ads] Interstitial failed: ${JSON.stringify(info)}`);
          })
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Loaded, () => {
            setRewardReady(true);
            setRewardLoading(false);
            addLog('[Ads] Rewarded loaded');
          })
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => {
            addLog(`[Ads] Reward granted: ${JSON.stringify(reward)}`);
          })
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
            setRewardReady(false);
            addLog('[Ads] Rewarded dismissed');
          })
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.FailedToLoad, (info) => {
            setRewardLoading(false);
            addLog(`[Ads] Rewarded failed: ${JSON.stringify(info)}`);
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Ads] Listener registration failed: ${message}`);
      }
      adSubscriptions.current = listeners;
    };
    registerListeners();
    return () => {
      adSubscriptions.current.forEach((subscription) => {
        subscription.remove();
      });
      adSubscriptions.current = [];
    };
  }, [addLog]);



  const handleSpeak = useCallback(async () => {
    try {
      await speak(text, selectedVoice, rate, pitch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Speech] speak failed: ${message}`);
    }
  }, [speak, text, selectedVoice, rate, pitch, addLog]);

  const handleStop = useCallback(() => {
    cancel();
  }, [cancel]);

  const handleShareAudio = useCallback(async () => {
    if (!synthesizeToFile) {
      addLog('[Speech] share is not available on this platform');
      return;
    }
    if (!selectedVoice) {
      addLog('[Speech] No voice selected for sharing');
      return;
    }
    try {
      const result = await synthesizeToFile(text, selectedVoice, rate, pitch);
      await NativeTTS.shareAudio({ uri: result.uri });
      addLog(`[Speech] Audio shared from ${result.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Speech] share failed: ${message}`);
    }
  }, [synthesizeToFile, text, selectedVoice, rate, pitch, addLog]);

  const handleOpenSettings = useCallback(() => {
    if (!openSettings) {
      addLog('[Speech] Settings not available');
      return;
    }
    openSettings().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Speech] openSettings failed: ${message}`);
    });
  }, [openSettings, addLog]);

  const openStoreReviewPage = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storeUrl = STORE_REVIEW_URL;
    const newWindow = window.open(storeUrl, '_blank', 'noopener');
    if (!newWindow) {
      window.location.href = storeUrl;
    }
  }, []);

  const handleRateApp = useCallback(async () => {
    const platform = Capacitor.getPlatform();
    if (platform === 'web') {
      openStoreReviewPage();
      addLog('[Utilities] rateApp fallback opened store page (web)');
      return;
    }

    try {
      const result = await NativeUtilities.rateApp();
      addLog('[Utilities] rateApp invoked');
      if (result?.fallback) {
        const reason = result.reason ?? 'unknown';
        addLog(`[Utilities] rateApp fallback triggered (${reason})`);
        if (platform !== 'android' && platform !== 'ios') {
          openStoreReviewPage();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Utilities] rateApp failed: ${message}`);
       openStoreReviewPage();
       addLog('[Utilities] Store page opened as fallback');
    }
  }, [addLog, openStoreReviewPage]);

  const handleShareApp = useCallback(async () => {
    const platform = Capacitor.getPlatform();
    const shareText = SHARE_APP_TEXT;

    const tryNativeShare = async () => {
      await NativeUtilities.shareApp({ text: shareText });
      addLog('[Utilities] shareApp invoked');
    };

    const tryWebShare = async () => {
      if (typeof navigator !== 'undefined') {
        const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
        if (typeof nav.share === 'function') {
          try {
            await nav.share({
              title: 'Mask2077',
              text: shareText,
              url: SHARE_APP_URL,
            });
            addLog('[Utilities] Web share invoked');
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              addLog('[Utilities] Web share cancelled by user');
              return;
            }
            throw error;
          }
        }

        if (nav.clipboard?.writeText) {
          await nav.clipboard.writeText(shareText);
          addLog('[Utilities] Share text copied to clipboard');
          return;
        }
      }

      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        const opened = window.open(SHARE_APP_URL, '_blank', 'noopener');
        if (opened) {
          addLog('[Utilities] Store page opened for sharing');
          return;
        }
      }

      throw new Error('Web share is not supported');
    };

    if (platform !== 'web') {
      try {
        await tryNativeShare();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Utilities] Native share failed: ${message}`);
      }
    }

    try {
      await tryWebShare();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Utilities] shareApp failed: ${message}`);
    }
  }, [addLog]);

  const handleClearCache = useCallback(async () => {
    try {
      await NativeUtilities.clearCache();
      addLog('[Utilities] clearCache invoked');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Utilities] clearCache failed: ${message}`);
    }
  }, [addLog]);

  const handlePurchase = useCallback(
    async (productId: string, kind: 'nonConsumable' | 'consumable' | 'subscription') => {
      try {
        const result =
          kind === 'nonConsumable'
            ? await NativePurchases.buyNonConsumable({ productId })
            : kind === 'consumable'
            ? await NativePurchases.buyConsumable({ productId })
            : await NativePurchases.buySubscription({ productId });
        const orderLabel = result.orderId ? `, orderId=${result.orderId}` : '';
        addLog(`[Purchases] ${kind} purchase Ð·Ð°Ð²ÐµÑÑÐµÐ½Ð°: ${result.productId}, token=${result.purchaseToken}${orderLabel}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Purchases] ${kind} purchase failed: ${message}`);
      }
    },
    [addLog]
  );

  const handleBanner = useCallback(
    async (action: 'show' | 'hide' | 'remove') => {
      try {
        if (action === 'show') {
          await AdMob.showBanner({
            adId: BANNER_AD_UNIT_ID,
            adSize: BannerAdSize.ADAPTIVE_BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
          });
          setBannerVisible(true);
          addLog('[Ads] Banner show requested');
        } else if (action === 'hide') {
          await AdMob.hideBanner();
          setBannerVisible(false);
          addLog('[Ads] Banner hidden');
        } else {
          await AdMob.removeBanner();
          setBannerVisible(false);
          addLog('[Ads] Banner removed');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Ads] Banner ${action} failed: ${message}`);
      }
    },
    [addLog]
  );

  const handleLoadInterstitial = useCallback(async () => {
    setInterstitialLoading(true);
    try {
      await AdMob.prepareInterstitial({
        adId: INTERSTITIAL_AD_UNIT_ID,
      });
      addLog('[Ads] Interstitial load requested');
    } catch (error) {
      setInterstitialLoading(false);
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Ads] Interstitial load failed: ${message}`);
    }
  }, [addLog]);

  const handleShowInterstitial = useCallback(async () => {
    try {
      await AdMob.showInterstitial();
      addLog('[Ads] Interstitial show requested');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Ads] Interstitial show failed: ${message}`);
    }
  }, [addLog]);

  const handleLoadRewarded = useCallback(async () => {
    setRewardLoading(true);
    try {
      await AdMob.prepareRewardVideoAd({
        adId: REWARDED_AD_UNIT_ID,
      });
      addLog('[Ads] Rewarded load requested');
    } catch (error) {
      setRewardLoading(false);
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Ads] Rewarded load failed: ${message}`);
    }
  }, [addLog]);

  const handleShowRewarded = useCallback(async () => {
    try {
      await AdMob.showRewardVideoAd();
      addLog('[Ads] Rewarded show requested');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Ads] Rewarded show failed: ${message}`);
    }
  }, [addLog]);


  const resetToHome = useCallback(() => {
    addLog('screen_home');
    setScreen('home');
    setWebSiteContext('generic');
    setYoutubeUrlInput('');
    setYoutubeUrlError(null);
  }, [addLog]);

  const buildWebPortalUrl = useCallback(() => {
    try {
      const url = new URL(WEB_PORTAL_URL);
      const trimmedText = text.trim();
      const voiceParam = selectedVoice
        ? selectedVoice.provider === 'native'
          ? selectedVoice.nativeId ?? selectedVoice.id
          : selectedVoice.id
        : null;

      url.searchParams.set('usingNative', usingNative ? '1' : '0');

      if (usingNative && selectedEngineId) {
        url.searchParams.set('engine', selectedEngineId);
      } else {
        url.searchParams.delete('engine');
      }

      if (voiceParam) {
        url.searchParams.set('voice', voiceParam);
        if (selectedVoice?.name) {
          url.searchParams.set('voiceName', selectedVoice.name);
        } else {
          url.searchParams.delete('voiceName');
        }
      } else {
        url.searchParams.delete('voice');
        url.searchParams.delete('voiceName');
      }

      if (selectedLanguage && selectedLanguage !== 'all') {
        url.searchParams.set('language', selectedLanguage);
      } else {
        url.searchParams.delete('language');
      }

      url.searchParams.set('rate', String(rate));
      url.searchParams.set('pitch', String(pitch));

      if (trimmedText) {
        url.searchParams.set('text', trimmedText);
      } else {
        url.searchParams.delete('text');
      }

      return url.toString();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Web] Failed to build portal URL: ${message}`);
      return WEB_PORTAL_URL;
    }
  }, [
    addLog,
    pitch,
    rate,
    selectedEngineId,
    selectedLanguage,
    selectedVoice,
    text,
    usingNative,
  ]);

  const handleOpenTtsFromHome = useCallback(() => {
    trackHomeButton('tts');
    addLog('screen_tts');
    setScreen('tts');
  }, [trackHomeButton, addLog]);

  const handleOpenYoutubeFromHome = useCallback(() => {
    trackHomeButton('youtube');
    addLog('screen_youtube');
    setWebSiteContext('youtube');
    setYoutubeUrlInput('');
    setYoutubeUrlError(null);
    setWebSiteUrl(YOUTUBE_MOBILE_URL);
    addLog('screen_website_yt');
    setScreen('site');
  }, [trackHomeButton, addLog]);

  const handleOpenWebsiteFromHome = useCallback(() => {
    trackHomeButton('website');
    addLog('screen_website_lobby');
    setWebSiteContext('generic');
    setYoutubeUrlInput('');
    setYoutubeUrlError(null);
    const url = buildWebPortalUrl();
    addLog('[Sync] Opening web portal', {
      url,
      nativePreferred: usingNative,
      localEngine: usingNative ? selectedEngineId : 'web',
      voice: selectedVoice?.name ?? null,
    });
    setWebSiteUrl(url);
    setScreen('site');
  }, [trackHomeButton, addLog, buildWebPortalUrl, selectedEngineId, selectedVoice, usingNative]);

  const handleOpenFontsFromHome = useCallback(() => {
    trackHomeButton('fonts');
    addLog('screen_fonts');
    setScreen('fonts');
  }, [trackHomeButton, addLog]);

  const handleOpenRemindersFromHome = useCallback(() => {
    trackHomeButton('reminders');
    addLog('screen_reminders');
    setScreen('reminders');
  }, [trackHomeButton, addLog]);

  const handleFontToggle = useCallback(
    (fontFamily: string | null, checked: boolean) => {
      setSelectedFontFamily((previous) => {
        const nextValue = checked ? fontFamily : previous === fontFamily ? null : previous;
        if (nextValue !== previous) {
          addLog('[Fonts] Selected font', { font: nextValue ?? 'default' });
        }
        return nextValue;
      });
    },
    [addLog]
  );

  const handleFontsConfirm = useCallback(() => {
    addLog('[Fonts] Selection confirmed', { font: selectedFontFamily ?? 'default' });
    setScreen('home');
  }, [addLog, selectedFontFamily]);

  const handleYoutubeInputChange = useCallback(
    (value: string) => {
      setYoutubeUrlInput(value);
      if (youtubeUrlError) {
        setYoutubeUrlError(null);
      }
    },
    [youtubeUrlError]
  );

  const handleYoutubeLinkSubmit = useCallback(() => {
    if (!youtubeUrlInput.trim()) {
      setYoutubeUrlError('Добавьте ссылку на видео YouTube.');
      return;
    }

    const normalizedUrl = buildYoutubeEmbedUrl(youtubeUrlInput);

    if (!normalizedUrl) {
      setYoutubeUrlError('Не удалось распознать ссылку. Проверьте адрес и попробуйте снова.');
      addLog(`[YouTube] Invalid link: ${youtubeUrlInput}`);
      return;
    }

    setYoutubeUrlError(null);
    setWebSiteUrl(normalizedUrl);
    addLog(`[YouTube] Open video: ${normalizedUrl}`);
  }, [youtubeUrlInput, addLog]);

  const handleOpenAdsFromHome = useCallback(() => {
    trackHomeButton('ads');
    addLog('screen_ads');
    setScreen('ads');
  }, [trackHomeButton, addLog]);

  const handleOpenPurchasesFromHome = useCallback(() => {
    trackHomeButton('purchases');
    addLog('screen_iapp');
    setScreen('purchases');
  }, [trackHomeButton, addLog]);

  const handleOpenFileFromHome = useCallback(() => {
    trackHomeButton('file');
    addLog('screen_file_viewer');
    setScreen('file');
  }, [trackHomeButton, addLog]);

  const handleFileButtonClick = useCallback(() => {
    setFileError(null);
    fileInputRef.current?.click();
  }, [setFileError, fileInputRef]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { files } = event.target;
      const selectedFile = files && files[0];

      if (!selectedFile) {
        return;
      }

      setFileError(null);
      setFileName(selectedFile.name);
      addLog(`[File] Reading file ${selectedFile.name} (${selectedFile.size} bytes)`);

      const reader = new FileReader();
      const inputElement = event.target;

      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        setFileContent(result);
        addLog(`[File] Loaded content from ${selectedFile.name}`);
      };

      reader.onerror = () => {
        const message =
          reader.error instanceof Error
            ? reader.error.message
            : reader.error
            ? String(reader.error)
            : 'Unknown error';
        setFileError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0444\u0430\u0439\u043b.');
        setFileContent('');
        addLog(`[File] Failed to read ${selectedFile.name}: ${message}`);
      };

      reader.onloadend = () => {
        inputElement.value = '';
      };

      try {
        reader.readAsText(selectedFile, 'UTF-8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFileError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0444\u0430\u0439\u043b.');
        setFileContent('');
        addLog(`[File] Failed to start reading ${selectedFile.name}: ${message}`);
        inputElement.value = '';
      }
    },
    [addLog]
  );

  const handleShareAppFromHome = useCallback(() => {
    trackHomeButton('share_app');
    void handleShareApp();
  }, [trackHomeButton, handleShareApp]);

  const handleClearCacheFromHome = useCallback(() => {
    trackHomeButton('clear_cache');
    void handleClearCache();
  }, [trackHomeButton, handleClearCache]);

  const clearScheduledReminder = useCallback((id: string) => {
    const timeoutId = reminderTimersRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      reminderTimersRef.current.delete(id);
    }
  }, []);

  const clearAllReminderTimers = useCallback(() => {
    reminderTimersRef.current.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    reminderTimersRef.current.clear();
  }, []);

  const cancelNativeNotification = useCallback(
    async (notificationId: number | null) => {
      if (!localNotificationsSupported || notificationId === null) {
        return;
      }

      try {
        await LocalNotifications.cancel({
          notifications: [{ id: notificationId }],
        });
        addLog(`[Reminders] Local notification cancelled id=${notificationId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Reminders] Failed to cancel local notification ${notificationId}: ${message}`);
      }
    },
    [addLog, localNotificationsSupported]
  );

  const scheduleNativeNotification = useCallback(
    async (reminder: Reminder) => {
      if (!localNotificationsSupported || reminder.notificationId === null) {
        return;
      }
      if (localNotificationPermission.current !== 'granted') {
        return;
      }
      try {
        const scheduleDate = new Date(reminder.nextTriggerAt);
        await LocalNotifications.cancel({
          notifications: [{ id: reminder.notificationId }],
        });
        await LocalNotifications.schedule({
          notifications: [
            {
              id: reminder.notificationId,
              title: REMINDER_NOTIFICATION_TITLE,
              body: REMINDER_NOTIFICATION_BODY,
              schedule: {
                at: scheduleDate,
                allowWhileIdle: true,
              },
              extra: {
                reminderId: reminder.id,
                loop: reminder.loop,
                durationMs: reminder.durationMs,
              },
            },
          ],
        });
        addLog(
          `[Reminders] Local notification scheduled id=${reminder.notificationId} at=${scheduleDate.toISOString()}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Reminders] Failed to schedule local notification ${reminder.id}: ${message}`);
      }
    },
    [addLog, localNotificationsSupported]
  );

  const dispatchReminderNotification = useCallback(
    (context: 'single' | 'loop') => {
      if (localNotificationsSupported && localNotificationPermission.current === 'granted') {
        setReminderStatus(
          context === 'loop'
            ? '\u0426\u0438\u043a\u043b\u0438\u0447\u043d\u043e\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b\u043e.'
            : '\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b\u043e.'
        );
        return;
      }

      if (typeof window === 'undefined') {
        addLog('[Reminders] Notification skipped: window not available');
        return;
      }

      if ('Notification' in window) {
        const permission = Notification.permission;

        if (permission === 'granted') {
          new Notification(REMINDER_NOTIFICATION_TITLE, { body: REMINDER_NOTIFICATION_BODY });
          addLog('[Reminders] Web notification displayed');
          setReminderStatus(
            context === 'loop'
              ? '\u0426\u0438\u043a\u043b\u0438\u0447\u043d\u043e\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b\u043e.'
              : '\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b\u043e.'
          );
          return;
        }

        if (permission === 'default') {
          Notification.requestPermission()
            .then((result) => {
              addLog(`[Reminders] Web permission requested: ${result}`);
              if (result === 'granted') {
                new Notification(REMINDER_NOTIFICATION_TITLE, { body: REMINDER_NOTIFICATION_BODY });
                setReminderStatus(
                  context === 'loop'
                    ? '\u0426\u0438\u043a\u043b\u0438\u0447\u043d\u043e\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b\u043e.'
                    : '\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b\u043e.'
                );
              } else {
                setReminderStatus('\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0439 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.');
              }
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              addLog(`[Reminders] Web permission request failed: ${message}`);
            });
          return;
        }

        setReminderStatus('\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u044b \u043d\u0430 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435.');
        addLog('[Reminders] Web notification blocked, fallback to alert');
        window.alert(REMINDER_NOTIFICATION_BODY);
        return;
      }

      addLog('[Reminders] Notification API unavailable, using alert fallback');
      window.alert(REMINDER_NOTIFICATION_BODY);
      setReminderStatus('\u0422\u0430\u0439\u043c\u0435\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d (\u0441\u0438\u0441\u0442\u0435\u043c\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435).');
    },
    [addLog, localNotificationsSupported]
  );

  const processReminderTrigger = useCallback(
    (reminderId: string, triggeredAt: number) => {
      const lastTrigger = reminderLastTriggerRef.current.get(reminderId);
      if (lastTrigger !== undefined && triggeredAt - lastTrigger < 750) {
        return { rescheduled: null as Reminder | null, cancelledNotificationId: null as number | null, loop: false, skipped: true };
      }
      reminderLastTriggerRef.current.set(reminderId, triggeredAt);

      let rescheduled: Reminder | null = null;
      let cancelledNotificationId: number | null = null;
      let loop = false;

      setReminders((previous) =>
        previous.map((item) => {
          if (item.id !== reminderId) {
            return item;
          }

          loop = item.loop;
          if (item.loop) {
            const updated: Reminder = {
              ...item,
              lastTriggeredAt: triggeredAt,
              nextTriggerAt: triggeredAt + item.durationMs,
              status: 'scheduled',
            };
            rescheduled = updated;
            addLog(`[Reminders] Loop reminder triggered (${item.id}), rescheduling.`);
            return updated;
          }

          cancelledNotificationId = item.notificationId;
          addLog(`[Reminders] Reminder triggered (${item.id}).`);
          return {
            ...item,
            lastTriggeredAt: triggeredAt,
            status: 'completed',
            notificationId: null,
          };
        })
      );

      dispatchReminderNotification(loop ? 'loop' : 'single');

      return { rescheduled, cancelledNotificationId, loop, skipped: false };
    },
    [addLog, dispatchReminderNotification]
  );

  const scheduleReminder = useCallback(
    (reminder: Reminder) => {
      if (typeof window === 'undefined') {
        return;
      }

      if (reminder.status === 'completed') {
        clearScheduledReminder(reminder.id);
        return;
      }

      const delay = Math.max(reminder.nextTriggerAt - Date.now(), 0);
      clearScheduledReminder(reminder.id);

      const timeoutId = window.setTimeout(() => {
        const result = processReminderTrigger(reminder.id, Date.now());
        if (!result || result.skipped) {
          return;
        }

        if (result.rescheduled) {
          scheduleReminder(result.rescheduled);
          void scheduleNativeNotification(result.rescheduled);
        } else {
          clearScheduledReminder(reminder.id);
          if (result.cancelledNotificationId !== null) {
            void cancelNativeNotification(result.cancelledNotificationId);
          }
        }
      }, delay);

      reminderTimersRef.current.set(reminder.id, timeoutId);
    },
    [cancelNativeNotification, clearScheduledReminder, processReminderTrigger, scheduleNativeNotification]
  );

  const handleNativeNotificationFired = useCallback(
    (reminderId: string) => {
      const result = processReminderTrigger(reminderId, Date.now());
      if (!result || result.skipped) {
        return;
      }

      if (result.rescheduled) {
        scheduleReminder(result.rescheduled);
        void scheduleNativeNotification(result.rescheduled);
      } else {
        clearScheduledReminder(reminderId);
        if (result.cancelledNotificationId !== null) {
          void cancelNativeNotification(result.cancelledNotificationId);
        }
      }
    },
    [cancelNativeNotification, clearScheduledReminder, processReminderTrigger, scheduleNativeNotification, scheduleReminder]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (remindersLoadedRef.current) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(REMINDERS_STORAGE_KEY);
      if (!raw) {
        remindersLoadedRef.current = true;
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        remindersLoadedRef.current = true;
        return;
      }

      const nowTs = Date.now();
      const restored: Reminder[] = parsed
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }

          const id =
            typeof item.id === 'string' ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const durationMs = Number(item.durationMs);
          if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return null;
          }

          const loop = Boolean(item.loop);
          const createdAt = Number(item.createdAt);
          const status = item.status === 'completed' ? 'completed' : 'scheduled';
          const lastTriggeredAt =
            typeof item.lastTriggeredAt === 'number' && Number.isFinite(item.lastTriggeredAt)
              ? item.lastTriggeredAt
              : null;

          const rawNextTrigger = Number(item.nextTriggerAt);
          const safeNextTrigger =
            Number.isFinite(rawNextTrigger) && rawNextTrigger > 0 ? rawNextTrigger : nowTs + durationMs;
          const nextTriggerAt =
            status === 'completed' ? safeNextTrigger : Math.max(nowTs + 1000, safeNextTrigger);

          let notificationId =
            typeof item.notificationId === 'number' && Number.isFinite(item.notificationId)
              ? item.notificationId
              : null;

          if (notificationId === null && localNotificationsSupported && localNotificationPermission.current === 'granted') {
            notificationId = Math.floor(Math.random() * 1_000_000_000);
          }

          return {
            id,
            durationMs,
            loop,
            createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : nowTs,
            nextTriggerAt,
            lastTriggeredAt,
            status,
            notificationId,
          } as Reminder;
        })
        .filter((value): value is Reminder => value !== null);

      remindersRef.current = restored;
      setReminders(restored);
      restored.forEach((reminder) => {
        if (reminder.status === 'scheduled') {
          scheduleReminder(reminder);
          void scheduleNativeNotification(reminder);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Reminders] Failed to load saved reminders: ${message}`);
    } finally {
      remindersLoadedRef.current = true;
    }
  }, [addLog, localNotificationsSupported, scheduleNativeNotification, scheduleReminder]);

  useEffect(() => {
    if (!localNotificationsSupported) {
      return;
    }

    const handleReminderFromNotification = (payload: unknown) => {
      const maybeReminderId =
        typeof payload === 'object' && payload !== null && 'reminderId' in (payload as Record<string, unknown>)
          ? (payload as Record<string, unknown>).reminderId
          : undefined;
      if (typeof maybeReminderId === 'string') {
        handleNativeNotificationFired(maybeReminderId);
      }
    };

    const receivedListener = LocalNotifications.addListener('localNotificationReceived', (notification) => {
      handleReminderFromNotification(notification.extra ?? null);
    });

    const actionListener = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      handleReminderFromNotification(event.notification?.extra ?? null);
    });

    return () => {
      void receivedListener.remove();
      void actionListener.remove();
    };
  }, [handleNativeNotificationFired, localNotificationsSupported]);

  const handleCreateReminder = useCallback(async () => {
    const duration = parseReminderDuration(reminderInputValue.trim());

    if (!duration) {
      setReminderError('\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0444\u043e\u0440\u043c\u0430\u0442. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 [\u0434\u043d\u0438]:[\u0447\u0430\u0441\u044b]:[\u043c\u0438\u043d\u0443\u0442\u044b].');
      setReminderStatus(null);
      return;
    }

    if (typeof window === 'undefined') {
      setReminderStatus('\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u0432 \u0438\u043d\u0442\u0435\u0440\u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0439 \u0441\u0440\u0435\u0434\u0435.');
      return;
    }

    setReminderError(null);

    let permission: NotificationPermission | undefined;
    if ('Notification' in window) {
      permission = Notification.permission;
      if (permission === 'default') {
        try {
          permission = await Notification.requestPermission();
          addLog(`[Reminders] Permission requested before scheduling: ${permission}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addLog(`[Reminders] Permission preflight failed: ${message}`);
        }
      }

      if (permission === 'denied') {
        setReminderStatus('\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u0432 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430, \u0447\u0442\u043e\u0431\u044b \u0432\u0438\u0434\u0435\u0442\u044c \u0430\u043b\u0435\u0440\u0442 \u043d\u0430\u043f\u0440\u044f\u043c\u0443\u044e.');
      }
    }

    let notificationId: number | null = null;

    if (localNotificationsSupported) {
      try {
        const currentPermissions = await LocalNotifications.checkPermissions();
        let displayState = normalizePermissionState(currentPermissions.display);
        localNotificationPermission.current = displayState;

        if (displayState !== 'granted') {
          const requested = await LocalNotifications.requestPermissions();
          displayState = normalizePermissionState(requested.display);
          localNotificationPermission.current = displayState;
          addLog(`[Reminders] Local notification permission requested: ${displayState}`);
        } else {
          addLog('[Reminders] Local notification permission already granted');
        }

        if (displayState === 'granted') {
          notificationId = Math.floor(Math.random() * 1_000_000_000);
        } else if (displayState === 'denied') {
          setReminderStatus('\u0412 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f \u0432\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u0434\u043b\u044f Mask2077.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Reminders] Local notification permission failed: ${message}`);
      }
    } else {
      localNotificationPermission.current = 'denied';
    }

    const nowTs = Date.now();
    const newReminder: Reminder = {
      id: `${nowTs}-${Math.random().toString(16).slice(2)}`,
      durationMs: duration,
      loop: reminderLoopEnabled,
      createdAt: nowTs,
      nextTriggerAt: nowTs + duration,
      lastTriggeredAt: null,
      status: 'scheduled',
      notificationId,
    };

    setReminders((previous) => [...previous, newReminder]);
    setReminderStatus('\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u043e.');
    addLog(
      `[Reminders] Created reminder ${newReminder.id} loop=${newReminder.loop} duration=${duration}ms`
    );
    setReminderInputValue(REMINDER_DEFAULT_TIMER_VALUE);
    scheduleReminder(newReminder);
    if (notificationId !== null) {
      void scheduleNativeNotification(newReminder);
    }
  }, [
    addLog,
    localNotificationsSupported,
    reminderInputValue,
    reminderLoopEnabled,
    scheduleNativeNotification,
    scheduleReminder,
  ]);

  const handleDeleteReminder = useCallback(
    (id: string) => {
      const existing = remindersRef.current.find((item) => item.id === id);
      if (!existing) {
        setReminderStatus('\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0443\u0436\u0435 \u0443\u0434\u0430\u043b\u0435\u043d\u043e.');
        return;
      }

      clearScheduledReminder(id);
      void cancelNativeNotification(existing.notificationId);
      setReminders((previous) => previous.filter((item) => item.id !== id));
      setReminderError(null);
      setReminderStatus('\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u0443\u0434\u0430\u043b\u0435\u043d\u043e.');
      addLog(`[Reminders] Reminder deleted ${id}`);
    },
    [addLog, cancelNativeNotification, clearScheduledReminder]
  );

  useEffect(
    () => () => {
      clearAllReminderTimers();
    },
    [clearAllReminderTimers]
  );

  const handleRateAppFromHome = useCallback(() => {
    trackHomeButton('rate_app');
    void handleRateApp();
  }, [trackHomeButton, handleRateApp]);

  const handleShowLogs = useCallback(() => {
    setShowLogs(true);
  }, []);

  const handleShowLogsFromHome = useCallback(() => {
    trackHomeButton('show_logs');
    handleShowLogs();
  }, [trackHomeButton, handleShowLogs]);

  const renderSpeechPanel = () => (
    <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
      {usingNative && engines.length > 0 && (
        <Select
          label="Движок (TTS Engine)"
          value={selectedEngineId}
          onChange={(event) => selectEngine(event.target.value)}
          options={engineOptions}
          disabled={speaking}
        />
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Select
          label="Язык"
          value={selectedLanguage}
          onChange={(event) => selectLanguage(event.target.value)}
          options={languageSelectOptions}
          disabled={speaking || languageSelectOptions.length === 0}
        />
        <Select
          label="Голос"
          value={selectedVoice?.id ?? ''}
          onChange={(event) => setVoiceId(event.target.value)}
          options={voiceOptions}
          disabled={speaking || voiceOptions.length === 0}
        />
        <Select
          label="Скорость"
          value={rate}
          onChange={(event) => setRate(toNumber(event.target.value))}
          options={SPEECH_RATES}
          disabled={speaking}
        />
      </div>

      <div className="flex flex-col">
        <label className="mb-2 text-sm font-medium text-gray-300">
          Питч (тон): <span className="font-mono">{pitch.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={pitch}
          onChange={(event) => setPitch(parseFloat(event.target.value))}
          disabled={speaking}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-700 accent-emerald-400"
        />
      </div>

      <TextArea
        label="Текст для синтеза"
        value={text}
        fontFamily={formattedSelectedFont}
        onChange={(event) => setText(event.target.value)}
        placeholder="Введите текст для синтеза речи..."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Button
          variant={speaking ? 'secondary' : 'primary'}
          onClick={speaking ? handleStop : handleSpeak}
          disabled={!text.trim() || !selectedVoice}
        >
          {speaking ? 'Остановить' : 'Синтез'}
        </Button>
        <Button
          variant="primary"
          onClick={handleShareAudio}
          disabled={!synthesizeToFile || !text.trim() || !selectedVoice || speaking}
        >
          Поделиться аудио
        </Button>
        <Button variant="neutral" onClick={handleOpenSettings} disabled={!openSettings}>
          Настройки
        </Button>
      </div>
    </section>
  );


  const renderReminders = () => {
    const sortedReminders = [...reminders].sort((a, b) => {
      if (a.status === b.status) {
        return a.nextTriggerAt - b.nextTriggerAt;
      }
      return a.status === 'completed' ? 1 : -1;
    });

    return (
      <div className="max-w-3xl mx-auto px-6 pt-20 pb-16 space-y-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-widest text-emerald-300">Reminders</p>
            <h1 className="text-3xl font-semibold text-white">
              {'\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f'}
            </h1>
            <p className="text-sm text-slate-300">
              {'\u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u0442\u0430\u0439\u043c\u0435\u0440 \u0432 \u0444\u043e\u0440\u043c\u0430\u0442\u0435 [\u0434\u043d\u0438]:[\u0447\u0430\u0441\u044b]:[\u043c\u0438\u043d\u0443\u0442\u044b] \u0438 \u043c\u044b \u0432\u044b\u0432\u0435\u0441\u0442\u0438\u043c \u0441\u0442\u0430\u043d\u0434\u0430\u0440\u0442\u043d\u043e\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
              {'\u041d\u0430\u0437\u0430\u0434'}
            </Button>
            <Button variant="highlight" className="w-auto px-6" onClick={handleShowLogs}>
              {'\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043b\u043e\u0433'}
            </Button>
          </div>
        </header>

        <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
          <div className="space-y-4">
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
              {'\u0422\u0430\u0439\u043c\u0435\u0440'}
              <input
                type="text"
                value={reminderInputValue}
                onChange={(event) => setReminderInputValue(event.target.value)}
                placeholder="00:00:10"
                inputMode="numeric"
                pattern="\\d{1,2}:\\d{1,2}:\\d{1,2}"
                className="w-full rounded-lg border border-slate-600 bg-slate-900/60 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
              />
            </label>
            <label className="inline-flex items-center gap-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={reminderLoopEnabled}
                onChange={(event) => setReminderLoopEnabled(event.target.checked)}
                className="h-5 w-5 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500/60"
              />
              {'\u041f\u0435\u0442\u043b\u044f (\u043f\u043e\u0432\u0442\u043e\u0440 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f)'}
            </label>
            {reminderError && <p className="text-sm text-red-400">{reminderError}</p>}
            {reminderStatus && <p className="text-sm text-emerald-300">{reminderStatus}</p>}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="primary" className="sm:w-auto" onClick={handleCreateReminder}>
                {'\u0421\u043e\u0437\u0434\u0430\u0442\u044c'}
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              {'\u0422\u0435\u043a\u0441\u0442 \u0438 \u0438\u043a\u043e\u043d\u043a\u0430 \u0432 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0438 \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e.'}
            </p>
          </div>
        </section>

        <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold text-white">
              {'\u0421\u043f\u0438\u0441\u043e\u043a \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0439'}
            </h2>
            <p className="text-xs text-slate-400">
              {`\u0412 \u0441\u043f\u0438\u0441\u043a\u0435: ${sortedReminders.length}`}
            </p>
          </div>
          {sortedReminders.length === 0 ? (
            <p className="text-sm text-slate-300">
              {'\u0421\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0442 \u043d\u0438 \u043e\u0434\u043d\u043e\u0433\u043e \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f. \u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043d\u043e\u0432\u043e\u0435 \u0441\u043d\u0430\u0447\u0430\u043b\u0430.'}
            </p>
          ) : (
            <div className="space-y-4">
              {sortedReminders.map((reminder) => {
                const remainingMs =
                  reminder.status === 'completed'
                    ? 0
                    : Math.max(reminder.nextTriggerAt - currentTime, 0);
                const countdownLabel = formatReminderCountdown(remainingMs);
                const intervalLabel = formatReminderDuration(reminder.durationMs);
                const statusLabel =
                  reminder.status === 'completed'
                    ? '\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e'
                    : '\u0412 \u043e\u0436\u0438\u0434\u0430\u043d\u0438\u0438';
                const nextTriggerLabel =
                  reminder.status === 'completed'
                    ? '\u0422\u0430\u0439\u043c\u0435\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d'
                    : new Date(reminder.nextTriggerAt).toLocaleString();
                const lastTriggeredLabel = reminder.lastTriggeredAt
                  ? new Date(reminder.lastTriggeredAt).toLocaleString()
                  : null;

                return (
                  <div
                    key={reminder.id}
                    className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2 text-sm text-slate-200">
                        <p>
                          <span className="text-slate-400">
                            {'\u0421\u0442\u0430\u0442\u0443\u0441:'}
                          </span>{' '}
                          {statusLabel}
                        </p>
                        <p>
                          <span className="text-slate-400">
                            {'\u041e\u0441\u0442\u0430\u043b\u043e\u0441\u044c:'}
                          </span>{' '}
                          <span className="font-mono text-base text-emerald-300">
                            {countdownLabel}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-400">
                            {'\u0418\u043d\u0442\u0435\u0440\u0432\u0430\u043b:'}
                          </span>{' '}
                          {intervalLabel}
                        </p>
                        <p>
                          <span className="text-slate-400">
                            {'\u0420\u0435\u0436\u0438\u043c:'}
                          </span>{' '}
                          {reminder.loop
                            ? '\u041f\u0435\u0442\u043b\u044f (\u043f\u043e\u0432\u0442\u043e\u0440)'
                            : '\u0420\u0430\u0437\u043e\u0432\u043e\u0435'}
                        </p>
                        <p>
                          <span className="text-slate-400">
                            {'\u0421\u043e\u0437\u0434\u0430\u043d\u043e:'}
                          </span>{' '}
                          {new Date(reminder.createdAt).toLocaleString()}
                        </p>
                        <p>
                          <span className="text-slate-400">
                            {'\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0435 \u0441\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u043d\u0438\u0435:'}
                          </span>{' '}
                          {nextTriggerLabel}
                        </p>
                        {lastTriggeredLabel && (
                          <p>
                            <span className="text-slate-400">
                              {'\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435 \u0441\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u043d\u0438\u0435:'}
                            </span>{' '}
                            {lastTriggeredLabel}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-stretch gap-2 sm:items-end">
                        <Button
                          variant="secondary"
                          className="w-full sm:w-auto px-5"
                          onClick={() => handleDeleteReminder(reminder.id)}
                        >
                          {'\u0423\u0434\u0430\u043b\u0438\u0442\u044c'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  };


  const renderHome = () => (
    <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">TTS synth</p>
          <h1 className="text-3xl font-semibold">Режим синтеза</h1>
          <p className="text-sm text-slate-300">Платформа: {platformLabel}</p>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Button variant="primary" onClick={handleOpenFileFromHome}>
            {'\u041e\u0442\u043a\u0440\u044b\u0442\u044c'}
          </Button>
          <Button variant="primary" onClick={handleOpenTtsFromHome}>
            Синтез
          </Button>
          <Button variant="primary" onClick={handleOpenRemindersFromHome}>
            {'\u041d\u0430\u043f\u043e\u043c\u043d\u0438\u0442\u044c'}
          </Button>
          <Button variant="primary" onClick={handleOpenFontsFromHome}>
            {'\u0428\u0440\u0438\u0444\u0442\u044b'}
          </Button>
          <Button variant="primary" onClick={handleOpenYoutubeFromHome}>
            YouTube
          </Button>
          {isNativePlatform && (
            <Button variant="primary" onClick={handleOpenWebsiteFromHome}>
              Веб сайт
            </Button>
          )}
          <Button variant="primary" onClick={handleOpenAdsFromHome}>
            Реклама
          </Button>
          <Button variant="primary" onClick={handleOpenPurchasesFromHome}>
            Покупки
          </Button>
          <Button variant="secondary" onClick={handleRateAppFromHome}>
            Оценить
          </Button>
          <Button variant="neutral" onClick={handleShareAppFromHome}>
            Поделиться
          </Button>
          <Button variant="neutral" onClick={handleClearCacheFromHome}>
            Clear cache
          </Button>
          <Button variant="highlight" onClick={handleShowLogsFromHome}>
            Журнал логов
          </Button>
        </div>
      </section>
    </div>
  );

  const renderFileViewer = () => (
    <div className="max-w-3xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-widest text-emerald-300">Files</p>
          <h1 className="text-3xl font-semibold text-white">
            {'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0442\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0439 \u0444\u0430\u0439\u043b'}
          </h1>
          {fileName ? (
            <p className="text-sm text-slate-300">{`\u0424\u0430\u0439\u043b: ${fileName}`}</p>
          ) : (
            <p className="text-sm text-slate-300">
              {'\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0439 \u0444\u0430\u0439\u043b \u043d\u0430 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435.'}
            </p>
          )}
          {fileError && <p className="text-sm text-red-400">{fileError}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            {'\u041d\u0430\u0437\u0430\u0434'}
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={handleShowLogs}>
            {'\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043b\u043e\u0433'}
          </Button>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <div className="flex flex-col gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain,.md,.json"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button variant="primary" className="w-full sm:w-auto" onClick={handleFileButtonClick}>
            {'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0444\u0430\u0439\u043b'}
          </Button>
          <div className="min-h-[280px] max-h-[480px] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm leading-relaxed whitespace-pre-wrap font-mono">
            {fileContent ? fileContent : '\u0424\u0430\u0439\u043b \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d.'}
          </div>
        </div>
      </section>
    </div>
  );

  const renderFonts = () => (
    <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-slate-700/70 bg-gray-900/95 shadow-xl px-6 py-6 space-y-4">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-widest text-emerald-300">Fonts</p>
            <h1 className="text-3xl font-semibold text-white">Font playground</h1>
            <p className="text-sm text-slate-300">
              {fontDetectionCompleted
                ? `Detected fonts: ${mergedFontOptions.length}`
                : 'Scanning available fonts...'}
            </p>
            <p className="text-xs text-slate-500">
              Source: {availableFonts.length > 0 ? 'device fonts' : 'fallback list'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
              {'\u041d\u0430\u0437\u0430\u0434'}
            </Button>
            <Button variant="highlight" className="w-auto px-6" onClick={handleShowLogs}>
              {'\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043b\u043e\u0433'}
            </Button>
          </div>
        </header>
        <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
          Preview text
          <textarea
            value={fontPreviewValue}
            onChange={(event) => setFontPreviewValue(event.target.value)}
            rows={2}
            placeholder={FONT_PREVIEW_PARAGRAPH}
            className="w-full resize-y rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          />
        </label>
      </section>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-6 shadow-xl space-y-4 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">Available fonts</h2>
        <div className="space-y-3">
          {fontRows.map((font) => {
            const isChecked =
              font.family === null ? selectedFontFamily === null : selectedFontFamily === font.family;
            const fontFamilyValue = composeFontFamily(font.family);
            const disabled = !fontDetectionCompleted && font.key !== 'default';
            const cardClass = `rounded-2xl border p-4 space-y-3 ${
              isChecked ? 'border-emerald-500/70 bg-slate-800/80 shadow-lg shadow-emerald-900/10' : 'border-slate-700 bg-slate-800/60'
            }`;
            return (
              <div key={font.key} className={cardClass}>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-emerald-400"
                    checked={isChecked}
                    onChange={(event) => handleFontToggle(font.family, event.target.checked)}
                    disabled={disabled}
                  />
                  <span className="text-base font-semibold text-slate-100">{font.label}</span>
                </label>
                <div
                  className={`rounded-xl border px-3 py-2 text-sm text-slate-50 ${
                    isChecked ? 'border-emerald-500/60 bg-slate-900/60' : 'border-slate-700 bg-slate-900/70'
                  }`}
                  style={{ fontFamily: fontFamilyValue }}
                >
                  {fontPreviewText}
                </div>
              </div>
            );
          })}
        </div>
        {!fontDetectionCompleted && (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/40 p-6 text-sm text-slate-300">
            Detecting fonts...
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Button variant="primary" className="w-auto px-8" onClick={handleFontsConfirm}>
          OK
        </Button>
      </div>
    </div>
  );
  const renderSite = () => {
    const urlInputConfig =
      webSiteContext === 'youtube'
        ? {
            value: youtubeUrlInput,
            onChange: handleYoutubeInputChange,
            onSubmit: handleYoutubeLinkSubmit,
            placeholder: 'Вставьте ссылку на видео YouTube',
            helperText: 'Например, https://youtu.be/{id} или https://www.youtube.com/watch?v={id}',
            error: youtubeUrlError ?? undefined,
          }
        : undefined;
    const sitePresentation = webSiteContext === 'youtube' ? 'default' : 'minimal';

    return (
      <WebExperience
        siteUrl={webSiteUrl}
        onBack={resetToHome}
        onShowLogs={handleShowLogsFromHome}
        addLog={addLog}
        urlInput={urlInputConfig}
        presentation={sitePresentation}
      />
    );
  };


  const renderAds = () => (
    <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">AdMob</p>
          <h1 className="text-3xl font-semibold">Ð¢ÐµÑÑ ÑÐµÐºÐ»Ð°Ð¼Ñ</h1>
          <p className="text-sm text-slate-300">
            Ð¡ÑÐ°ÑÑÑ: {adMobReady ? 'Ð³Ð¾ÑÐ¾Ð²Ð¾' : 'Ð¸Ð½Ð¸ÑÐ¸Ð°Ð»Ð¸Ð·Ð°ÑÐ¸Ñ...'} Â· ÐÐ°Ð½Ð½ÐµÑ: {bannerVisible ? 'Ð¾ÑÐ¾Ð±ÑÐ°Ð¶Ð°ÐµÑÑÑ' : 'ÑÐºÑÑÑ'} Â·
            Interstitial: {interstitialReady ? 'Ð·Ð°Ð³ÑÑÐ¶ÐµÐ½' : 'Ð½Ðµ Ð³Ð¾ÑÐ¾Ð²'} Â· Rewarded: {rewardReady ? 'Ð·Ð°Ð³ÑÑÐ¶ÐµÐ½' : 'Ð½Ðµ Ð³Ð¾ÑÐ¾Ð²'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            ÐÐ°Ð·Ð°Ð´
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={handleShowLogs}>
            ÐÑÑÐ½Ð°Ð»
          </Button>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">ÐÐ°Ð½Ð½ÐµÑ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Button variant="primary" onClick={() => handleBanner('show')} disabled={!adMobReady}>
            ÐÐ¾ÐºÐ°Ð·Ð°ÑÑ Ð±Ð°Ð½Ð½ÐµÑ
          </Button>
          <Button variant="neutral" onClick={() => handleBanner('hide')} disabled={!adMobReady}>
            Ð¡ÐºÑÑÑÑ Ð±Ð°Ð½Ð½ÐµÑ
          </Button>
          <Button variant="secondary" onClick={() => handleBanner('remove')} disabled={!adMobReady}>
            Ð£Ð´Ð°Ð»Ð¸ÑÑ Ð±Ð°Ð½Ð½ÐµÑ
          </Button>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">Interstitial</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button variant="primary" onClick={handleLoadInterstitial} disabled={interstitialLoading}>
            ÐÐ°Ð³ÑÑÐ·Ð¸ÑÑ
          </Button>
          <Button variant="neutral" onClick={handleShowInterstitial} disabled={!interstitialReady}>
            ÐÐ¾ÐºÐ°Ð·Ð°ÑÑ
          </Button>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">Rewarded</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button variant="primary" onClick={handleLoadRewarded} disabled={rewardLoading}>
            ÐÐ°Ð³ÑÑÐ·Ð¸ÑÑ
          </Button>
          <Button variant="neutral" onClick={handleShowRewarded} disabled={!rewardReady}>
            ÐÐ¾ÐºÐ°Ð·Ð°ÑÑ
          </Button>
        </div>
      </section>
    </div>
  );

  const renderPurchases = () => (
    <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">ÐÐ¾ÐºÑÐ¿ÐºÐ¸</p>
          <h1 className="text-3xl font-semibold">Ð¡Ð¸Ð¼ÑÐ»ÑÑÐ¸Ñ Ð¿Ð»Ð°ÑÐµÐ¶ÐµÐ¹</h1>
          <p className="text-sm text-slate-300">
            ÐÐ° ÑÑÐ¾Ð¼ ÑÐºÑÐ°Ð½Ðµ Ð²ÑÐ·ÑÐ²Ð°ÑÑÑÑ Ð·Ð°Ð³Ð»ÑÑÐºÐ¸ NativePurchasesPlugin. Ð ÐµÐ·ÑÐ»ÑÑÐ°Ñ Ð²ÑÐ²Ð¾Ð´Ð¸ÑÑÑ Ð² Ð»Ð¾Ð³.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            ÐÐ°Ð·Ð°Ð´
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={handleShowLogs}>
            ÐÑÑÐ½Ð°Ð»
          </Button>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button variant="primary" onClick={() => handlePurchase('id_pro', 'nonConsumable')}>
            ÐÑÐ¿Ð¸ÑÑ PRO (id_pro)
          </Button>
          <Button variant="primary" onClick={() => handlePurchase('id_d_1', 'consumable')}>
            ÐÑÐ¿Ð¸ÑÑ Ð´Ð¾Ð½Ð°Ñ (id_d_1)
          </Button>
          <Button variant="primary" onClick={() => handlePurchase('premium_month_1', 'subscription')}>
            ÐÐ¾Ð´Ð¿Ð¸ÑÐºÐ° (premium_month_1)
          </Button>
        </div>
      </section>
    </div>
  );

  const renderContent = () => {
    if (screen === 'file') {
      return renderFileViewer();
    }
    if (screen === 'tts') {
      return renderTts();
    }
    if (screen === 'site') {
      return renderSite();
    }
    if (screen === 'ads') {
      return renderAds();
    }
    if (screen === 'purchases') {
      return renderPurchases();
    }
    if (screen === 'fonts') {
      return renderFonts();
    }
    if (screen === 'reminders') {
      return renderReminders();
    }
    return renderHome();
  };


  if (!supportCheckReady) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-900 text-white">
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-semibold text-emerald-400">Mask2077</h1>
            <p className="text-gray-400">Çàãðóæàåì ïðèëîæåíèå...</p>
          </div>
        </div>
        <div className="w-full px-6 pb-12">
          <div className="relative max-w-xl mx-auto h-12 bg-slate-800/70 border border-slate-700 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500 transition-[width] duration-200 ease-out"
              style={{ width: `${Math.min(loadingProgress, 100)}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-lg font-semibold">
              {`${Math.round(Math.min(loadingProgress, 100))}%`}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!supported) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center p-8 bg-gray-800 rounded-xl shadow-2xl space-y-3">
          <h1 className="text-2xl font-bold text-red-500">Speech Synthesis Not Supported</h1>
          <p className="text-gray-400">
            ÐÐ°ÑÐµ Ð¾ÐºÑÑÐ¶ÐµÐ½Ð¸Ðµ Ð½Ðµ Ð¿Ð¾Ð´Ð´ÐµÑÐ¶Ð¸Ð²Ð°ÐµÑ ÑÐ¸Ð½ÑÐµÐ· ÑÐµÑÐ¸. ÐÐ°Ð¿ÑÑÑÐ¸ÑÐµ Android-Ð¿ÑÐ¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ Ð¸Ð»Ð¸ Ð±ÑÐ°ÑÐ·ÐµÑ Ñ Web Speech API.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {renderContent()}
      <LogOverlay
        visible={showLogs}
        logs={logs}
        onClose={() => setShowLogs(false)}
        onClear={clearLogs}
      />
    </div>
  );
};

export default App;


