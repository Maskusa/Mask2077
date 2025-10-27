import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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

type Screen = 'home' | 'tts' | 'site' | 'ads' | 'purchases';

const BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';
const REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
const SHARE_APP_TEXT =
  'Check out this game: https://play.google.com/store/apps/details?id=com.subtit.player.';
const SHARE_APP_URL = 'https://play.google.com/store/apps/details?id=com.subtit.player';
const YOUTUBE_MOBILE_URL = 'https://m.youtube.com/';
const YOUTUBE_EMBED_BASE_URL = 'https://www.youtube.com/embed/';

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

  useEffect(() => {
    if (screen === 'site') {
      const presentation = webSiteContext === 'youtube' ? 'default' : 'minimal';
      addLog(`[Web] screen=site context=${webSiteContext} presentation=${presentation}`);
    }
  }, [screen, webSiteContext, addLog]);

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

  const handleShareAppFromHome = useCallback(() => {
    trackHomeButton('share_app');
    void handleShareApp();
  }, [trackHomeButton, handleShareApp]);

  const handleClearCacheFromHome = useCallback(() => {
    trackHomeButton('clear_cache');
    void handleClearCache();
  }, [trackHomeButton, handleClearCache]);

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
          <h1 className="text-3xl font-semibold">Режим синтеза</h1>
          <p className="text-sm text-slate-300">Платформа: {platformLabel}</p>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-800/70 backdrop-blur p-8 shadow-xl space-y-6 border border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Button variant="primary" onClick={handleOpenTtsFromHome}>
            Синтез
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
