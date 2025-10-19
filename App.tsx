
import React, { useState, useEffect, useMemo } from 'react';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import type { SelectOption } from './types';
import { SPEECH_RATES, DEFAULT_TEXT } from './constants';
import Select from './components/Select';
import Button from './components/Button';
import TextArea from './components/TextArea';

const App: React.FC = () => {
  const { supported, voices, speaking, speak, cancel } = useSpeechSynthesis();
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState<number>(0);
  const [text, setText] = useState<string>(DEFAULT_TEXT);
  const [rate, setRate] = useState<number>(1);

  useEffect(() => {
    if (voices.length > 0) {
      // Try to find a default voice for the local language, otherwise default to the first one.
      const defaultLang = navigator.language;
      const defaultVoiceIndex = voices.findIndex(voice => voice.lang.startsWith(defaultLang));
      setSelectedVoiceIndex(defaultVoiceIndex > -1 ? defaultVoiceIndex : 0);
    }
  }, [voices]);

  const voiceOptions = useMemo<SelectOption[]>(() => 
    voices.map((voice, index) => ({
      value: index,
      label: `${voice.name} (${voice.lang})`,
    })), [voices]);

  const handleSpeak = () => {
    const selectedVoice = voices[selectedVoiceIndex] || null;
    speak(text, selectedVoice, rate);
  };

  if (!supported) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center p-8 bg-gray-800 rounded-lg shadow-2xl">
          <h1 className="text-2xl font-bold text-red-500">Speech Synthesis Not Supported</h1>
          <p className="mt-2 text-gray-400">Your browser does not support the Web Speech API. Please try a different browser like Chrome or Firefox.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="w-full max-w-2xl mx-auto bg-gray-800 rounded-2xl shadow-2xl p-8 space-y-6 transform transition-all">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            Text-to-Speech Synthesizer
          </h1>
          <p className="text-gray-400 mt-2">Bring your text to life with natural-sounding voices.</p>
        </header>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Voice"
              value={selectedVoiceIndex}
              onChange={(e) => setSelectedVoiceIndex(parseInt(e.target.value, 10))}
              options={voiceOptions}
              disabled={speaking || voices.length === 0}
            />
            <Select
              label="Speed"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              options={SPEECH_RATES}
              disabled={speaking}
            />
          </div>
          <TextArea
            label="Text to Synthesize"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text here..."
          />
        </div>

        <div className="pt-2">
           <Button 
              onClick={speaking ? cancel : handleSpeak}
              disabled={!text.trim()}
              variant={speaking ? 'secondary' : 'primary'}
            >
              {speaking ? 'Stop Speaking' : 'Speak'}
            </Button>
        </div>
      </div>
    </div>
  );
};

export default App;
