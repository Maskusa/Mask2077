
import { useState, useEffect, useCallback } from 'react';

export interface SpeechSynthesisHook {
  supported: boolean;
  speaking: boolean;
  voices: SpeechSynthesisVoice[];
  speak: (text: string, voice: SpeechSynthesisVoice | null, rate: number) => void;
  cancel: () => void;
}

export const useSpeechSynthesis = (): SpeechSynthesisHook => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  const populateVoiceList = useCallback(() => {
    const newVoices = window.speechSynthesis.getVoices();
    setVoices(newVoices);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setSupported(true);
      populateVoiceList();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = populateVoiceList;
      }
    }
  }, [populateVoiceList]);

  const speak = (text: string, voice: SpeechSynthesisVoice | null, rate: number) => {
    if (!supported || speaking) return;
    window.speechSynthesis.cancel(); // Cancel any previous speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = rate;
    
    window.speechSynthesis.speak(utterance);
  };

  const cancel = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
    }
  };

  return { supported, speaking, voices, speak, cancel };
};
