import { showToast } from './common.js';

const BOOKS = {
  prologue: {
    title: 'Пролог — Предвестие бури',
    sections: {
      '0.1': {
        title: '0.1 Оазис на краю Вселенной',
        points: {
          '0.1.1': {
            title: '0.1.1 Безмолвное величие',
            text: [
              '2077 год. Город для большинства из десяти миллиардов душ, населявших Солнечную систему, стал лишь очередной остановкой между тьмой и неизведанным.',
              'Маск смотрел на безграничный изгиб орбитальных зеркал и чувствовал, как пустота за стеклом шаттла шепчет о новых решениях.',
            ],
          },
          '0.1.2': {
            title: '0.1.2 Оазис с ледяной пустоши',
            text: [
              'Под его ногами пульсировал город, построенный из света и командных строк. Здесь не было места случайности — каждый маршрут был просчитан, каждая встреча — срежиссирована.',
              'Айви, встроенная в контактные линзы и браслеты, просыпалась вместе с ним: «Глава разблокирована. Осталось 4 фрагмента до новой эры», — мягко проговорила она.',
              'Перед Маском открылся новый выбор. Продолжить путь гения или рискнуть и доверить Айви собственный голос.',
            ],
          },
        },
      },
    },
  },
};

const FONT_OPTIONS = [
  { id: 'alice', label: 'Alice', css: '\'Alice\', serif' },
  { id: 'droid-serif', label: 'Droid Serif', css: '\'Droid Serif\', serif' },
  { id: 'roboto', label: 'Roboto', css: '\'Roboto\', sans-serif' },
  { id: 'rt-sans', label: 'RT Sans', css: '\'PT Sans\', sans-serif' },
  { id: 'comfortaa', label: 'Comfortaa', css: '\'Comfortaa\', cursive' },
];

const THEME_PRESETS = {
  day: {
    text: '#322216',
    backdrop: 'linear-gradient(135deg, #fef6dd, #f8e1b5)',
  },
  night: {
    text: '#f2f6ff',
    backdrop: 'linear-gradient(135deg, #172033, #050b16)',
  },
  'night-contrast': {
    text: '#fefefe',
    backdrop: 'linear-gradient(135deg, #1c1d3b, #011221)',
  },
  sepia: {
    text: '#3a1a00',
    backdrop: 'linear-gradient(135deg, #fff1d0, #f7d5a3)',
  },
  'sepia-contrast': {
    text: '#2b1700',
    backdrop: 'linear-gradient(135deg, #ffe6bb, #eec37a)',
  },
  dusk: {
    text: '#361b44',
    backdrop: 'linear-gradient(135deg, #f7def7, #a8c8ff)',
  },
  console: {
    text: '#21ff88',
    backdrop: 'linear-gradient(135deg, #001924, #002c38)',
  },
};

const readerRoot = document.querySelector('.reader');
if (!readerRoot) {
  console.warn('[Reader] root element not found');
  return;
}

const readerText = document.getElementById('reader-text');
const readerTitle = document.getElementById('reader-title');
const readerChapter = document.getElementById('reader-chapter');
const readerProgress = document.getElementById('reader-progress');
const stylePopup = document.getElementById('style-popup');
const fontList = document.getElementById('font-list');

const urlParams = new URLSearchParams(window.location.search);
const state = {
  chapterId: urlParams.get('chapter') || readerRoot.dataset.defaultChapter || 'prologue',
  sectionId: urlParams.get('section') || readerRoot.dataset.defaultSection || '0.1',
  pointId: urlParams.get('point') || readerRoot.dataset.defaultPoint || '0.1.2',
  chunkIndex: Number(urlParams.get('chunk')) || 0,
  autoVoice: false,
  readerVoiceEnabled: true,
  style: {
    font: FONT_OPTIONS[0],
    fontSize: 46,
    lineHeight: 1.4,
    fontWeight: 500,
    theme: 'sepia',
  },
};

const speechSupported = 'speechSynthesis' in window;
let currentUtterance = null;

function getSection() {
  const chapter = BOOKS[state.chapterId];
  return chapter?.sections?.[state.sectionId] || null;
}

function getPoint() {
  const section = getSection();
  return section?.points?.[state.pointId] || null;
}

function ensureSelection() {
  const chapter = BOOKS[state.chapterId];
  if (!chapter) {
    state.chapterId = 'prologue';
  }
  const section = getSection();
  if (!section) {
    const firstSection = Object.keys(BOOKS[state.chapterId].sections)[0];
    state.sectionId = firstSection;
  }
  const point = getPoint();
  if (!point) {
    const firstPoint = Object.keys(getSection().points)[0];
    state.pointId = firstPoint;
  }
}

function renderFontList() {
  if (!fontList) return;
  fontList.innerHTML = '';
  FONT_OPTIONS.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'font-option';
    button.dataset.fontId = option.id;
    button.style.fontFamily = option.css;
    button.textContent = option.label;
    if (state.style.font.id === option.id) {
      button.classList.add('is-active');
    }
    button.addEventListener('click', () => {
      state.style.font = option;
      applyStyle();
      renderFontList();
    });
    fontList.appendChild(button);
  });
}

function applyStyle() {
  const { font, fontSize, lineHeight, fontWeight, theme } = state.style;
  readerRoot.style.setProperty('--reader-font-family', font.css);
  readerRoot.style.setProperty('--reader-font-size', ${fontSize}px);
  readerRoot.style.setProperty('--reader-line-height', lineHeight.toFixed(2));
  readerRoot.style.setProperty('--reader-font-weight', String(fontWeight));
  const preset = THEME_PRESETS[theme] ?? THEME_PRESETS.sepia;
  readerRoot.style.setProperty('--reader-text-color', preset.text);
  readerRoot.style.setProperty('--reader-backdrop', preset.backdrop);
  const fontSizeLabel = document.getElementById('font-size-label');
  if (fontSizeLabel) {
    fontSizeLabel.textContent = String(fontSize);
  }
  const lineHeightLabel = document.getElementById('line-height-label');
  if (lineHeightLabel) {
    lineHeightLabel.textContent = `${Math.round(lineHeight * 100)}%`;
  }
  const weightInput = document.getElementById('font-weight');
  if (weightInput) {
    weightInput.value = String(fontWeight);
  }
  const themeSelect = document.getElementById('style-theme');
  if (themeSelect) {
    themeSelect.value = theme;
  }
}

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
    showToast('Браузер не поддерживает Web Speech API');
    return;
  }
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function updateAutoVoiceButton() {
  const toggle = readerRoot.querySelector('[data-action="toggle-auto-voice"]');
  if (!toggle) return;
  toggle.setAttribute('aria-pressed', String(state.autoVoice));
  toggle.textContent = state.autoVoice ? '🔊' : '🔈';
}

function updateChunkVisibility(textBlocks) {
  const total = textBlocks.length;
  readerProgress.style.width = total > 0 ? ${((state.chunkIndex + 1) / total) * 100}% : '0%';
  textBlocks.forEach((block, index) => {
    block.classList.toggle('hidden', index !== state.chunkIndex);
  });
}

function renderReader() {
  ensureSelection();
  const point = getPoint();
  const section = getSection();
  readerTitle.textContent = BOOKS[state.chapterId].title;
  readerChapter.textContent = point?.title || section?.title || '';
  readerText.innerHTML = '';
  const paragraphs = point?.text?.length ? point.text : ['Этот пункт ещё недоступен. Откройте его в магазине.'];
  const textBlocks = paragraphs.map((paragraph, index) => {
    const p = document.createElement('p');
    p.textContent = paragraph;
    if (index !== state.chunkIndex) {
      p.classList.add('hidden');
    }
    readerText.appendChild(p);
    return p;
  });
  updateChunkVisibility(textBlocks);
  if (state.autoVoice && paragraphs[state.chunkIndex]) {
    speak(paragraphs[state.chunkIndex]);
  }
}

function changeChunk(direction) {
  const point = getPoint();
  const total = point?.text?.length || 1;
  const nextIndex = Math.min(Math.max(state.chunkIndex + direction, 0), total - 1);
  if (nextIndex === state.chunkIndex) return;
  state.chunkIndex = nextIndex;
  renderReader();
}

function toggleAutoVoice() {
  if (!speechSupported) {
    showToast('Озвучка недоступна в этом браузере');
    return;
  }
  state.autoVoice = !state.autoVoice;
  if (!state.autoVoice) {
    stopSpeaking();
  }
  updateAutoVoiceButton();
  const point = getPoint();
  if (state.autoVoice && point?.text?.[state.chunkIndex]) {
    speak(point.text[state.chunkIndex]);
  }
}

function openStylePopup() {
  if (!stylePopup) return;
  stylePopup.hidden = false;
  const opener = readerRoot.querySelector('[data-action="open-style"]');
  opener?.setAttribute('aria-expanded', 'true');
}

function closeStylePopup() {
  if (!stylePopup) return;
  stylePopup.hidden = true;
  const opener = readerRoot.querySelector('[data-action="open-style"]');
  opener?.setAttribute('aria-expanded', 'false');
}

function adjustFontSize(delta) {
  state.style.fontSize = Math.min(Math.max(state.style.fontSize + delta, 24), 72);
  applyStyle();
}

function adjustLineHeight(delta) {
  state.style.lineHeight = Math.min(Math.max(state.style.lineHeight + delta, 1.0), 2.0);
  applyStyle();
}

readerRoot.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  switch (action) {
    case 'prev-chunk':
      event.preventDefault();
      changeChunk(-1);
      break;
    case 'next-chunk':
      event.preventDefault();
      changeChunk(1);
      break;
    case 'toggle-auto-voice':
      event.preventDefault();
      toggleAutoVoice();
      break;
    case 'open-style':
      event.preventDefault();
      openStylePopup();
      break;
    case 'close-style':
      event.preventDefault();
      closeStylePopup();
      break;
    case 'font-increase':
      event.preventDefault();
      adjustFontSize(2);
      break;
    case 'font-decrease':
      event.preventDefault();
      adjustFontSize(-2);
      break;
    case 'line-increase':
      event.preventDefault();
      adjustLineHeight(0.1);
      break;
    case 'line-decrease':
      event.preventDefault();
      adjustLineHeight(-0.1);
      break;
    case 'open-font-search':
      event.preventDefault();
      window.open('https://fonts.google.com/?subset=cyrillic', '_blank', 'noopener');
      break;
    default:
      break;
  }
});

stylePopup?.addEventListener('click', (event) => {
  if (event.target === stylePopup) {
    closeStylePopup();
  }
});

const weightInput = document.getElementById('font-weight');
weightInput?.addEventListener('input', () => {
  state.style.fontWeight = Number(weightInput.value);
  applyStyle();
});

const themeSelect = document.getElementById('style-theme');
themeSelect?.addEventListener('change', () => {
  state.style.theme = themeSelect.value;
  applyStyle();
});

const readerZones = readerRoot.querySelectorAll('.reader__zone');
readerZones.forEach((zone) => {
  zone.addEventListener('click', (event) => {
    const action = zone.dataset.action;
    if (action === 'prev-chunk') {
      changeChunk(-1);
    }
    if (action === 'next-chunk') {
      changeChunk(1);
    }
  });
});

renderFontList();
applyStyle();
renderReader();
updateAutoVoiceButton();
