import { registerPlugin } from '@capacitor/core';

export interface ShareOptions {
  text: string;
}

export interface RateAppResult {
  fallback?: boolean;
  reason?: string;
}

export interface NativeUtilitiesPlugin {
  rateApp(): Promise<RateAppResult>;
  shareApp(options: ShareOptions): Promise<void>;
  clearCache(): Promise<void>;
}

export const NativeUtilities = registerPlugin<NativeUtilitiesPlugin>('NativeUtilities');
