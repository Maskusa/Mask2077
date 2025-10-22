import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface NativeWebOverlayShowOptions {
  url: string;
}

export interface NativeWebOverlayUrlChangeEvent {
  url: string;
}

export interface NativeWebOverlayPlugin {
  show(options: NativeWebOverlayShowOptions): Promise<void>;
  hide(): Promise<void>;
  goBack(): Promise<void>;
  addListener(
    eventName: 'urlChange',
    listenerFunc: (event: NativeWebOverlayUrlChangeEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(eventName: 'showLogRequested', listenerFunc: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'closed', listenerFunc: () => void): Promise<PluginListenerHandle>;
}

export const NativeWebOverlay = registerPlugin<NativeWebOverlayPlugin>('NativeWebOverlay');

export const isNativeWebOverlayAvailable = (): boolean => {
  if (typeof Capacitor.isNativePlatform === 'function') {
    return Capacitor.isNativePlatform();
  }
  const platform = Capacitor.getPlatform();
  return platform !== 'web';
};
