import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeVoice {
  id: string;
  name: string;
  locale: string;
  quality?: number;
  latency?: number;
}

export interface NativeEngine {
  id: string;
  label: string;
}

export interface NativeTTSStateEvent {
  state: 'start' | 'done' | 'error';
}

export interface NativeLogEvent {
  message: string;
}

export interface NativeTTSPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  getEngines(): Promise<{ engines: NativeEngine[]; currentEngine?: string | null }>;
  selectEngine(options: { engineId: string }): Promise<{ engineId: string }>;
  getVoices(): Promise<{ voices: NativeVoice[] }>;
  getAvailableLanguages(): Promise<{ languages: string[]; defaultLanguage: string }>;
  speak(options: { text: string; voiceId?: string; rate?: number; pitch?: number }): Promise<{ success: boolean }>;
  stop(): Promise<void>;
  setPitch(options: { pitch: number }): Promise<void>;
  setSpeechRate(options: { rate: number }): Promise<void>;
  synthesizeToFile(options: { text: string; voiceId?: string; rate?: number; pitch?: number }): Promise<{ uri: string; path: string }>;
  shareAudio(options: { uri: string }): Promise<void>;
  openSettings(): Promise<void>;
  getLogs(): Promise<{ logs: string[] }>;
  clearLogs(): Promise<void>;
  addListener(eventName: 'ttsState', listenerFunc: (event: NativeTTSStateEvent) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'log', listenerFunc: (event: NativeLogEvent) => void): Promise<{ remove: () => void }>;
}

export const NativeTTS = registerPlugin<NativeTTSPlugin>('NativeTTS');

export const isNativePlatformAvailable = (): boolean => {
  const platform = Capacitor.getPlatform();
  if (platform) {
    return platform !== 'web';
  }
  if (typeof Capacitor.isNativePlatform === 'function') {
    return Capacitor.isNativePlatform();
  }
  return false;
};
