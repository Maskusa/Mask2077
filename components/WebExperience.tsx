import React, { useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import Button from './Button';
import { NativeWebOverlay, isNativeWebOverlayAvailable } from '../native/nativeWebOverlay';

interface WebExperienceUrlInputConfig {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  helperText?: string;
  error?: string;
}

interface WebExperienceProps {
  siteUrl: string;
  onBack: () => void;
  onShowLogs: () => void;
  addLog: (message: string) => void;
  urlInput?: WebExperienceUrlInputConfig;
  presentation?: 'default' | 'minimal';
}

const WebExperience: React.FC<WebExperienceProps> = ({
  siteUrl,
  onBack,
  onShowLogs,
  addLog,
  urlInput,
  presentation = 'default',
}) => {
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string>(siteUrl);
  const listenersRef = useRef<PluginListenerHandle[]>([]);
  const addLogRef = useRef(addLog);
  const showLogsRef = useRef(onShowLogs);
  const onBackRef = useRef(onBack);
  const layoutLogRef = useRef<string | null>(null);
  const isMinimal = presentation === 'minimal';

  useEffect(() => {
    addLogRef.current = addLog;
  }, [addLog]);

  useEffect(() => {
    showLogsRef.current = onShowLogs;
  }, [onShowLogs]);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    setOverlayUrl(siteUrl);
    setEmbeddedUrl(null);
  }, [siteUrl]);

  useEffect(() => {
    let cancelled = false;
    const overlaySupported = isNativeWebOverlayAvailable();

    const log = (message: string) => {
      addLogRef.current?.(message);
    };

    const cleanupListeners = () => {
      listenersRef.current.forEach((listener) => {
        void listener.remove();
      });
      listenersRef.current = [];
    };

    const openSite = async () => {
      const targetUrl = siteUrl;

      if (overlaySupported) {
        cleanupListeners();
        try {
          listenersRef.current.push(
            await NativeWebOverlay.addListener('urlChange', (event) => {
              if (cancelled) {
                return;
              }
              setOverlayUrl(event.url);
              log(`[Web] URL: ${event.url}`);
            })
          );
          listenersRef.current.push(
            await NativeWebOverlay.addListener('debug', (event) => {
              if (cancelled) {
                return;
              }
              log(`[WebOverlay] ${event.message}`);
            })
          );
          listenersRef.current.push(
            await NativeWebOverlay.addListener('showLogRequested', () => {
              if (cancelled) {
                return;
              }
              showLogsRef.current?.();
            })
          );
          listenersRef.current.push(
            await NativeWebOverlay.addListener('closed', () => {
              if (cancelled) {
                return;
              }
              log('[Web] Overlay closed');
              onBackRef.current?.();
            })
          );
          await NativeWebOverlay.show({ url: targetUrl, mode: presentation });
          log(`[Web] Overlay opened: ${targetUrl}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`[Web] Overlay failed: ${message}`);
          cleanupListeners();
          if (!cancelled) {
            setEmbeddedUrl(targetUrl);
          }
        }
      } else {
        setEmbeddedUrl(targetUrl);
        log(`[Web] Embedded: ${targetUrl}`);
      }
    };

    openSite().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`[Web] Unexpected openSite error: ${message}`);
    });

    return () => {
      cancelled = true;
      cleanupListeners();
      if (overlaySupported) {
        void NativeWebOverlay.hide().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          log(`[Web] Overlay hide failed: ${message}`);
        });
      }
    };
  }, [siteUrl]);

  const overlaySupported = isNativeWebOverlayAvailable();
  const showHeaderControls = !overlaySupported || embeddedUrl !== null;

  const contentPaddingClass = isMinimal ? 'px-0 pb-0' : 'px-6 pb-6';
  const embeddedWrapperClass = isMinimal
    ? 'w-full h-full overflow-hidden bg-black'
    : 'w-full h-full rounded-3xl border border-slate-800 overflow-hidden bg-black';
  const placeholderClass = isMinimal
    ? 'w-full h-full flex items-center justify-center text-sm text-slate-400'
    : 'w-full h-full rounded-3xl border border-dashed border-slate-700 flex items-center justify-center text-sm text-slate-400';

  useEffect(() => {
    const descriptor = `presentation=${presentation} minimal=${isMinimal} overlaySupported=${overlaySupported} embedded=${
      embeddedUrl ? 'yes' : 'no'
    } header=${!isMinimal && showHeaderControls ? 'show' : 'hide'}`;
    if (layoutLogRef.current !== descriptor) {
      layoutLogRef.current = descriptor;
      addLogRef.current?.(`[Web] layout ${descriptor}`);
    }
  }, [presentation, isMinimal, overlaySupported, embeddedUrl, showHeaderControls]);

  const handleUrlFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    urlInput?.onSubmit();
  };

  const content = (
    <div className={`flex-1 ${contentPaddingClass}`}>
      {embeddedUrl ? (
        <div className={embeddedWrapperClass}>
          <iframe
            title="Web page"
            src={embeddedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        </div>
      ) : (
        <div className={placeholderClass}>
          {overlaySupported ? 'Site opened in integrated browser' : 'Loading site...'}
        </div>
      )}
    </div>
  );

  if (isMinimal) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col">
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {showHeaderControls && (
        <header className="flex flex-col gap-4 px-6 pt-6 pb-4 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-3">
            <Button variant="neutral" className="w-auto px-6" onClick={onBack}>
              {'\u041d\u0430\u0437\u0430\u0434'}
            </Button>
            <Button variant="highlight" className="w-auto px-6" onClick={onShowLogs}>
              {'\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043b\u043e\u0433'}
            </Button>
          </div>
          {urlInput ? (
            <div className="w-full md:max-w-xl">
              <form onSubmit={handleUrlFormSubmit} className="flex flex-col gap-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={urlInput.value}
                    onChange={(event) => urlInput.onChange(event.target.value)}
                    placeholder={urlInput.placeholder}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                  <Button type="submit" variant="highlight" className="w-full sm:w-auto px-6">
                    {'\u041e\u0442\u043a\u0440\u044b\u0442\u044c'}
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {urlInput.error ? (
                    <span className="text-xs text-red-400">{urlInput.error}</span>
                  ) : (
                    urlInput.helperText && <span className="text-xs text-slate-400">{urlInput.helperText}</span>
                  )}
                  {overlaySupported && embeddedUrl === null && (
                    <span className="hidden sm:block text-xs text-emerald-300 truncate max-w-xs">{overlayUrl}</span>
                  )}
                </div>
              </form>
            </div>
          ) : (
            overlaySupported &&
            embeddedUrl === null && (
              <span className="hidden sm:block text-xs text-emerald-300 max-w-xs truncate text-right md:self-center">
                {overlayUrl}
              </span>
            )
          )}
        </header>
      )}
      {content}
    </div>
  );
};

export default WebExperience;
