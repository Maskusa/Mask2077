import type { LanguageInfo } from './constants/languages';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  localeRaw: string;
  languageCode: string;
  languageLabel: string;
  provider: 'web' | 'native';
  nativeId?: string;
  voice?: SpeechSynthesisVoice;
  languageInfo?: LanguageInfo;
}

export interface TTSEngine {
  id: string;
  label: string;
}

