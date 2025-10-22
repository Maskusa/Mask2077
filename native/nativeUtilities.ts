import { registerPlugin } from '@capacitor/core';

export interface ShareOptions {
  text: string;
}

export interface NativeUtilitiesPlugin {
  rateApp(): Promise<void>;
  shareApp(options: ShareOptions): Promise<void>;
}

export const NativeUtilities = registerPlugin<NativeUtilitiesPlugin>('NativeUtilities');
