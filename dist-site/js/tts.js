import { showToast } from './common.js';

const form = document.getElementById('tts-form');
if (!form) {
  console.warn('[TTS] form not found');
} else {
  const engineSelect = document.getElementById('tts-engine');
  const languageSelect = document.getElementById('tts-language');
  const voiceSelect = document.getElementById('tts-voice');
  const rateInput = document.getElementById('tts-rate');
  const pitchInput = document.getElementById('tts-pitch');
  const volumeInput = document.getElementById('tts-volume');
  const textArea = document.getElementById('tts-text');
  const readerVoiceToggle = document.getElementById('toggle-reader-voice');

  const speechSupported = 'speechSynthesis' in window;
  let voices = [];
  let currentUtterance = null;

  const state = {
    engine: 'web',
    language: 'ru',
    voiceURI: '',
    rate: Number(rateInput?.value ?? 1),
    pitch: Number(pitchInput?.value ?? 1),
    volume: Number(volumeInput?.value ?? 1),
  };

  function stopSpeaking() {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    if (currentUtterance) {
      currentUtterance.onend = null;
    }
    currentUtterance = null;
  }

  function speak(text) {
    if (!speechSupported) {
      showToast('Web Speech API недоступен в этом браузере');
      return;
    }
    stopSpeaking();
    if (!text.trim()) {
      showToast('Введите текст для озвучки');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.rate;
    utterance.pitch = state.pitch;
    utterance.volume = state.volume;
    const voice = voices.find((item) => item.voiceURI === state.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = state.language;
    }
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function populateLanguages() {
    if (!languageSelect) return;
    const languages = Array.from(
      new Set(
        voices
          .map((voice) => voice.lang)
          .filter(Boolean)
          .map((lang) => lang.split('-')[0])
      )
    );
    languageSelect.innerHTML = '';
    languages.forEach((lang) => {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent =
        lang === 'ru'
          ? 'Russian — Русский'
          : lang === 'en'
          ? 'English — Английский'
          : lang;
      languageSelect.appendChild(option);
    });
    if (!languages.includes(state.language)) {
      state.language = languages[0] ?? 'ru';
    }
    languageSelect.value = state.language;
  }

  function populateVoices() {
    if (!voiceSelect) return;
    voiceSelect.innerHTML = '';
    const filtered = voices.filter((voice) => voice.lang?.startsWith(state.language));
    filtered.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} · ${voice.lang}`;
      voiceSelect.appendChild(option);
    });
    const hasCurrent = filtered.some((voice) => voice.voiceURI === state.voiceURI);
    if (!hasCurrent && filtered.length > 0) {
      state.voiceURI = filtered[0].voiceURI;
    }
    voiceSelect.value = state.voiceURI;
  }

  function loadVoices() {
    if (!speechSupported) return;
    voices = window.speechSynthesis.getVoices();
    populateLanguages();
    populateVoices();
  }

  if (speechSupported) {
    engineSelect?.removeAttribute('disabled');
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }
    loadVoices();
  } else {
    engineSelect?.setAttribute('disabled', 'true');
    languageSelect?.setAttribute('disabled', 'true');
    voiceSelect?.setAttribute('disabled', 'true');
    showToast('Web Speech API недоступен. Озвучка будет работать в приложении.');
  }

  languageSelect?.addEventListener('change', () => {
    state.language = languageSelect.value;
    populateVoices();
  });

  voiceSelect?.addEventListener('change', () => {
    state.voiceURI = voiceSelect.value;
  });

  rateInput?.addEventListener('input', () => {
    state.rate = Number(rateInput.value);
  });

  pitchInput?.addEventListener('input', () => {
    state.pitch = Number(pitchInput.value);
  });

  volumeInput?.addEventListener('input', () => {
    state.volume = Number(volumeInput.value);
  });

  readerVoiceToggle?.addEventListener('change', () => {
    showToast(readerVoiceToggle.checked ? 'Озвучивание текста включено' : 'Озвучивание текста выключено');
  });

  form.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    switch (action) {
      case 'tts-speak':
        event.preventDefault();
        speak(textArea?.value ?? '');
        break;
      case 'tts-stop':
        event.preventDefault();
        stopSpeaking();
        break;
      default:
        break;
    }
  });

  window.addEventListener('beforeunload', stopSpeaking);
}

