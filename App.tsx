import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
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
import type { SelectOption, VoiceProfile } from './types';
import { NativeTTS } from './native/nativeTTS';
import { NativeWebOverlay, isNativeWebOverlayAvailable } from './native/nativeWebOverlay';
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

type Screen = 'home' | 'tts' | 'site' | 'ads' | 'purchases';

const BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';
const REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
const SHARE_APP_TEXT =
  'Посмотри какая игра: https://play.google.com/store/apps/details?id=com.subtit.player.';

const buildVoiceLabel = (voice: VoiceProfile): string => {
  const provider = voice.provider === 'native' ? 'native' : 'web';
  return `${voice.name} · ${voice.languageLabel} · ${provider}`;
};

const toNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 1 : parsed;
};

const buildEmbedUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu')) {
      let videoId = '';
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') ?? '';
      } else {
        const parts = url.pathname.split('/');
        videoId = parts[parts.length - 1];
      }
      if (!videoId) {
        return trimmed;
      }
      const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
      embed.searchParams.set('autoplay', '1');
      embed.searchParams.set('rel', '0');
      return embed.toString();
    }
    return url.toString();
  } catch {
    return null;
  }
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
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [interstitialReady, setInterstitialReady] = useState(false);
  const [interstitialLoading, setInterstitialLoading] = useState(false);
  const [rewardReady, setRewardReady] = useState(false);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [adMobReady, setAdMobReady] = useState(false);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const overlaySubscriptions = useRef<PluginListenerHandle[]>([]);
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
    return platform === 'web' ? 'браузер' : platform;
  }, []);

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
          <h1 className="text-3xl font-semibold">Режим синтеза</h1>
          <p className="text-sm text-slate-300">
            Источник: {stats.provider === 'native' ? 'нативный' : 'браузерный'} · {stats.voicesCount} голосов ·{' '}
            {stats.enginesCount} движок(ов)
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            Назад
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={() => setShowLogs(true)}>
            Журнал
          </Button>
        </div>
      </header>

      {renderSpeechPanel(false)}
    </div>
  );

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

  useEffect(() => {
    if (!isNativeWebOverlayAvailable()) {
      return;
    }
    const attachListeners = async () => {
      const listeners: PluginListenerHandle[] = [];
      try {
        listeners.push(
          await NativeWebOverlay.addListener('urlChange', (event) => {
            setOverlayUrl(event.url);
            addLog(`[Overlay] URL: ${event.url}`);
          })
        );
        listeners.push(
          await NativeWebOverlay.addListener('showLogRequested', () => {
            setShowLogs(true);
          })
        );
        listeners.push(
          await NativeWebOverlay.addListener('closed', () => {
            setOverlayUrl(null);
            addLog('[Overlay] Closed');
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[Overlay] Listener registration failed: ${message}`);
      }
      overlaySubscriptions.current = listeners;
    };
    attachListeners();
    return () => {
      overlaySubscriptions.current.forEach((subscription) => {
        subscription.remove();
      });
      overlaySubscriptions.current = [];
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

  const handleRateApp = useCallback(async () => {
    try {
      await NativeUtilities.rateApp();
      addLog('[Utilities] rateApp invoked');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Utilities] rateApp failed: ${message}`);
    }
  }, [addLog]);

  const handleShareApp = useCallback(async () => {
    try {
      await NativeUtilities.shareApp({ text: SHARE_APP_TEXT });
      addLog('[Utilities] shareApp invoked');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`[Utilities] shareApp failed: ${message}`);
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
        addLog(`[Purchases] ${kind} purchase завершена: ${result.productId}, token=${result.purchaseToken}${orderLabel}`);
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

  const handleOpenUrl = useCallback(
    async (urlOverride?: string) => {
      const source = urlOverride ?? youtubeUrl;
      const target = buildEmbedUrl(source);
      if (!target) {
        addLog('[Site] Invalid URL');
        return;
      }
      if (isNativeWebOverlayAvailable()) {
        try {
          await NativeWebOverlay.show({ url: target });
          setOverlayUrl(target);
          addLog(`[Site] Overlay opened: ${target}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addLog(`[Site] Overlay failed: ${message}`);
        }
      } else {
        setEmbeddedUrl(target);
        addLog(`[Site] Embedded URL: ${target}`);
      }
    },
    [youtubeUrl, addLog]
  );

  const handleCloseEmbed = useCallback(() => {
    setEmbeddedUrl(null);
    addLog('[Site] Embedded content closed');
  }, [addLog]);

  const resetToHome = useCallback(() => {
    setScreen('home');
  }, []);

  const handleOpenTtsFromHome = useCallback(() => {
    trackHomeButton('tts');
    setScreen('tts');
  }, [trackHomeButton, setScreen]);

  const handleOpenSiteFromHome = useCallback(() => {
    trackHomeButton('site');
    setScreen('site');
  }, [trackHomeButton, setScreen]);

  const handleOpenAdsFromHome = useCallback(() => {
    trackHomeButton('ads');
    setScreen('ads');
  }, [trackHomeButton, setScreen]);

  const handleOpenPurchasesFromHome = useCallback(() => {
    trackHomeButton('purchases');
    setScreen('purchases');
  }, [trackHomeButton, setScreen]);

  const handleRateAppFromHome = useCallback(() => {
    trackHomeButton('rate_app');
    void handleRateApp();
  }, [trackHomeButton, handleRateApp]);

  const handleShareAppFromHome = useCallback(() => {
    trackHomeButton('share_app');
    void handleShareApp();
  }, [trackHomeButton, handleShareApp]);

  const handleShowLogsFromHome = useCallback(() => {
    trackHomeButton('show_logs');
    setShowLogs(true);
  }, [trackHomeButton, setShowLogs]);

  const renderSpeechPanel = (withSiteControls: boolean) => (
    <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
      {withSiteControls && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300" htmlFor="youtube-url">
            Ссылка на YouTube или другой ресурс
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="youtube-url"
              type="url"
              value={youtubeUrl}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setYoutubeUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            />
            <Button variant="highlight" className="w-full sm:w-auto" onClick={() => handleOpenUrl()}>
              Открыть ссылку
            </Button>
          </div>
        </div>
      )}

      {usingNative && engines.length > 0 && (
        <Select
          label="Движок (TTS Engine)"
          value={selectedEngineId}
          onChange={(event) => selectEngine(event.target.value)}
          options={engines.map((engine) => ({ value: engine.id, label: engine.label }))}
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

      {embeddedUrl && !isNativeWebOverlayAvailable() && (
        <div className="space-y-4">
          <div className="aspect-video w-full overflow-hidden rounded-2xl border border-slate-700 bg-black">
            <iframe
              title="Embedded content"
              src={embeddedUrl}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={handleCloseEmbed}>
            Закрыть контент
          </Button>
        </div>
      )}

      <TextArea
        label="Текст для синтеза"
        value={text}
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

  const renderHome = () => (
    <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">TTS synth</p>
          <h1 className="text-3xl font-semibold">Главная панель</h1>
          <p className="text-sm text-slate-300">Платформа: {platformLabel}</p>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Button variant="primary" onClick={handleOpenTtsFromHome}>
            ТТС
          </Button>
          <Button variant="primary" onClick={handleOpenSiteFromHome}>
            Web режим
          </Button>
          <Button variant="primary" onClick={handleOpenAdsFromHome}>
            Тест рекламы
          </Button>
          <Button variant="primary" onClick={handleOpenPurchasesFromHome}>
            Покупки
          </Button>
          <Button variant="neutral" onClick={handleRateAppFromHome}>
            Оценить приложение
          </Button>
          <Button variant="neutral" onClick={handleShareAppFromHome}>
            Поделиться
          </Button>
          <Button variant="highlight" onClick={handleShowLogsFromHome}>
            Журнал событий
          </Button>
        </div>
      </section>
    </div>
  );

  const renderSite = () => (
    <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">Web synth</p>
          <h1 className="text-3xl font-semibold">Онлайн режим</h1>
          <p className="text-sm text-slate-300">
            Источник: {stats.provider === 'native' ? 'нативный' : 'браузерный'} · {stats.voicesCount} голосов ·{' '}
            {stats.enginesCount} движок(ов)
          </p>
          {overlayUrl && isNativeWebOverlayAvailable() && (
            <p className="text-xs text-emerald-300 break-all">Overlay: {overlayUrl}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            Назад
          </Button>
          <Button variant="primary" className="w-auto px-6" onClick={() => handleOpenUrl()}>
            Открыть YouTube
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={() => setShowLogs(true)}>
            Журнал
          </Button>
        </div>
      </header>

      {renderSpeechPanel(true)}
    </div>
  );

  const renderAds = () => (
    <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">AdMob</p>
          <h1 className="text-3xl font-semibold">Тест рекламы</h1>
          <p className="text-sm text-slate-300">
            Статус: {adMobReady ? 'готово' : 'инициализация...'} · Баннер: {bannerVisible ? 'отображается' : 'скрыт'} ·
            Interstitial: {interstitialReady ? 'загружен' : 'не готов'} · Rewarded: {rewardReady ? 'загружен' : 'не готов'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            Назад
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={() => setShowLogs(true)}>
            Журнал
          </Button>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">Баннер</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Button variant="primary" onClick={() => handleBanner('show')} disabled={!adMobReady}>
            Показать баннер
          </Button>
          <Button variant="neutral" onClick={() => handleBanner('hide')} disabled={!adMobReady}>
            Скрыть баннер
          </Button>
          <Button variant="secondary" onClick={() => handleBanner('remove')} disabled={!adMobReady}>
            Удалить баннер
          </Button>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">Interstitial</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button variant="primary" onClick={handleLoadInterstitial} disabled={interstitialLoading}>
            Загрузить
          </Button>
          <Button variant="neutral" onClick={handleShowInterstitial} disabled={!interstitialReady}>
            Показать
          </Button>
        </div>
      </section>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white">Rewarded</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button variant="primary" onClick={handleLoadRewarded} disabled={rewardLoading}>
            Загрузить
          </Button>
          <Button variant="neutral" onClick={handleShowRewarded} disabled={!rewardReady}>
            Показать
          </Button>
        </div>
      </section>
    </div>
  );

  const renderPurchases = () => (
    <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">Покупки</p>
          <h1 className="text-3xl font-semibold">Симуляция платежей</h1>
          <p className="text-sm text-slate-300">
            На этом экране вызываются заглушки NativePurchasesPlugin. Результат выводится в лог.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="neutral" className="w-auto px-6" onClick={resetToHome}>
            Назад
          </Button>
          <Button variant="highlight" className="w-auto px-6" onClick={() => setShowLogs(true)}>
            Журнал
          </Button>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button variant="primary" onClick={() => handlePurchase('id_pro', 'nonConsumable')}>
            Купить PRO (id_pro)
          </Button>
          <Button variant="primary" onClick={() => handlePurchase('id_d_1', 'consumable')}>
            Купить донат (id_d_1)
          </Button>
          <Button variant="primary" onClick={() => handlePurchase('premium_month_1', 'subscription')}>
            Подписка (premium_month_1)
          </Button>
        </div>
      </section>
    </div>
  );

  const renderContent = () => {
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
    return renderHome();
  };


  if (!supportCheckReady) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-900 text-white">
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-semibold text-emerald-400">Mask2077</h1>
            <p className="text-gray-400">��������� ����������...</p>
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
            Ваше окружение не поддерживает синтез речи. Запустите Android-приложение или браузер с Web Speech API.
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
