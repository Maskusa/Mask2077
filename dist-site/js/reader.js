import { showToast } from './common.js';
import { loadBookData } from './book-data.js';

const READER_PROGRESS_KEY = 'mask2077:reader-progress';
const FONT_OPTIONS = [
  { id: 'alice', label: 'Alice', css: "'Alice', serif" },
  { id: 'droid-serif', label: 'Droid Serif', css: "'Droid Serif', serif" },
  { id: 'roboto', label: 'Roboto', css: "'Roboto', sans-serif" },
  { id: 'rt-sans', label: 'RT Sans', css: "'PT Sans', sans-serif" },
  { id: 'comfortaa', label: 'Comfortaa', css: "'Comfortaa', cursive" },
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

let BOOKS = {};
let chapterOrder = [];

const readerRoot = document.querySelector('.reader');
if (!readerRoot) {
  console.warn('[Reader] root element not found');
  throw new Error('Reader root not found');
}

console.info('[Reader] Страница чтения активирована');

const readerText = document.getElementById('reader-text');
const readerTitle = document.getElementById('reader-title');
const readerChapter = document.getElementById('reader-chapter');
const readerProgress = document.getElementById('reader-progress');
const stylePopup = document.getElementById('style-popup');
const fontList = document.getElementById('font-list');

if (stylePopup) {
  stylePopup.hidden = true;
}

const urlParams = new URLSearchParams(window.location.search);
const datasetDefaults = {
  chapter: readerRoot.dataset.defaultChapter || null,
  section: readerRoot.dataset.defaultSection || null,
  point: readerRoot.dataset.defaultPoint || null,
};
const persistedProgress = loadPersistedProgress();
const queryChunk = Number(urlParams.get('chunk'));
const state = {
  chapterId: urlParams.get('chapter') ?? persistedProgress?.chapterId ?? datasetDefaults.chapter,
  sectionId: urlParams.get('section') ?? persistedProgress?.sectionId ?? datasetDefaults.section,
  pointId: urlParams.get('point') ?? persistedProgress?.pointId ?? datasetDefaults.point,
  chunkIndex: Number.isFinite(queryChunk)
    ? queryChunk
    : Number.isFinite(persistedProgress?.chunkIndex)
    ? persistedProgress.chunkIndex
    : 0,
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

console.info(
  '[Reader] Начальные параметры: chapter=%s, section=%s, point=%s',
  state.chapterId ?? '∅',
  state.sectionId ?? '∅',
  state.pointId ?? '∅'
);

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
  if (chapterOrder.length === 0) {
    return;
  }
  if (!state.chapterId || !BOOKS[state.chapterId]) {
    state.chapterId = chapterOrder[0];
    console.info('[Reader] Используем главу по умолчанию: %s', state.chapterId);
  }
  const chapter = BOOKS[state.chapterId];
  const sectionKeys = chapter ? Object.keys(chapter.sections) : [];
  if (!sectionKeys.length) {
    console.warn('[Reader] В главе нет разделов: %s', state.chapterId);
    state.sectionId = null;
    state.pointId = null;
    state.chunkIndex = 0;
    return;
  }
  if (!state.sectionId || !chapter.sections[state.sectionId]) {
    state.sectionId = sectionKeys[0];
    console.info('[Reader] Используем раздел по умолчанию: %s', state.sectionId);
  }
  const section = chapter.sections[state.sectionId];
  const pointKeys = section ? Object.keys(section.points) : [];
  if (!pointKeys.length) {
    console.warn('[Reader] В разделе нет пунктов: %s', state.sectionId);
    state.pointId = null;
    state.chunkIndex = 0;
    return;
  }
  if (!state.pointId || !section.points[state.pointId]) {
    state.pointId = pointKeys[0];
    console.info('[Reader] Используем пункт по умолчанию: %s', state.pointId);
  }
  const point = section.points[state.pointId];
  if (!point?.text?.[state.chunkIndex]) {
    state.chunkIndex = 0;
    console.info('[Reader] Сбрасываем индекс фрагмента к 0 для пункта %s', state.pointId);
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
      console.info('[Reader] Выбран шрифт: %s', option.label);
      applyStyle();
      renderFontList();
    });
    fontList.appendChild(button);
  });
}

function applyStyle() {
  const { font, fontSize, lineHeight, fontWeight, theme } = state.style;
  readerRoot.style.setProperty('--reader-font-family', font.css);
  readerRoot.style.setProperty('--reader-font-size', `${fontSize}px`);
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

  console.info(
    '[Reader] Применён стиль: шрифт=%s, размер=%d, межстрочный=%d%%, тема=%s',
    font.label,
    fontSize,
    Math.round(lineHeight * 100),
    theme
  );
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
    showToast('Озвучка не поддерживается браузером');
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
}

function changeChunk(direction) {
  console.info('[Reader] Запрос на перелистывание: direction=%d', direction);
  const point = getPoint();
  if (!point || !Array.isArray(point.text) || !point.text.length) {
    console.warn('[Reader] Перелистывание отменено: нет текста для текущего пункта');
    return;
  }
  const total = point.text.length;
  const nextIndex = Math.min(Math.max(state.chunkIndex + direction, 0), total - 1);
  if (nextIndex === state.chunkIndex) {
    return;
  }
  state.chunkIndex = nextIndex;
  renderReader();
  console.info('[Reader] Переключён фрагмент: текущий=%d из %d', state.chunkIndex + 1, total);
}

function toggleAutoVoice() {
  if (!speechSupported) {
    showToast('Озвучка не поддерживается браузером');
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
  console.info('[Reader] Стиль: попап открыт');
  const opener = readerRoot.querySelector('[data-action="open-style"]');
  opener?.setAttribute('aria-expanded', 'true');
}

function closeStylePopup() {
  if (!stylePopup) return;
  stylePopup.hidden = true;
  console.info('[Reader] Стиль: попап закрыт');
  const opener = readerRoot.querySelector('[data-action="open-style"]');
  opener?.setAttribute('aria-expanded', 'false');
}

function adjustFontSize(delta) {
  const previous = state.style.fontSize;
  state.style.fontSize = Math.min(Math.max(previous + delta, 24), 72);
  if (state.style.fontSize === previous) {
    console.info('[Reader] Размер шрифта достиг предела: %d', previous);
    return;
  }
  applyStyle();
  console.info('[Reader] Размер шрифта изменён: %d', state.style.fontSize);
}

function adjustLineHeight(delta) {
  const previous = state.style.lineHeight;
  state.style.lineHeight = Math.min(Math.max(previous + delta, 1.0), 2.0);
  if (Math.abs(state.style.lineHeight - previous) < 0.001) {
    console.info('[Reader] Межстрочный интервал достиг предела: %d%%', Math.round(previous * 100));
    return;
  }
  applyStyle();
  console.info('[Reader] Межстрочный интервал изменён: %d%%', Math.round(state.style.lineHeight * 100));
}

function handleAction(action, event) {
  switch (action) {
    case 'prev-chunk':
      event?.preventDefault?.();
      changeChunk(-1);
      break;
    case 'next-chunk':
      event?.preventDefault?.();
      changeChunk(1);
      break;
    case 'toggle-auto-voice':
      event?.preventDefault?.();
      toggleAutoVoice();
      break;
    case 'open-style':
      event?.preventDefault?.();
      openStylePopup();
      break;
    case 'close-style':
      event?.preventDefault?.();
      closeStylePopup();
      break;
    case 'font-increase':
      event?.preventDefault?.();
      adjustFontSize(2);
      break;
    case 'font-decrease':
      event?.preventDefault?.();
      adjustFontSize(-2);
      break;
    case 'line-increase':
      event?.preventDefault?.();
      adjustLineHeight(0.1);
      break;
    case 'line-decrease':
      event?.preventDefault?.();
      adjustLineHeight(-0.1);
      break;
    case 'open-font-search':
      event?.preventDefault?.();
      window.open('https://fonts.google.com/?subset=cyrillic', '_blank', 'noopener');
      break;
    default:
      break;
  }
}

readerRoot.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  if (!action) return;
  console.info('[Reader] Обработчик клика: action=%s', action);
  handleAction(action, event);
});

stylePopup?.addEventListener('click', (event) => {
  if (event.target === stylePopup) {
    console.info('[Reader] Клик за пределами попапа стилей');
    closeStylePopup();
    return;
  }
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  if (!action) return;
  console.info('[Reader] Обработчик попапа: action=%s', action);
  handleAction(action, event);
});

const fontWeightInput = document.getElementById('font-weight');
fontWeightInput?.addEventListener('input', () => {
  state.style.fontWeight = Number(fontWeightInput.value);
  applyStyle();
});

const themeSelect = document.getElementById('style-theme');
themeSelect?.addEventListener('change', () => {
  state.style.theme = themeSelect.value;
  applyStyle();
});

const readerZones = readerRoot.querySelectorAll('.reader__zone');
readerZones.forEach((zone) => {
  zone.addEventListener('click', () => {
    const { action } = zone.dataset;
    console.info('[Reader] Жест пролистывания: zone=%s', action);
    if (action === 'prev-chunk') {
      changeChunk(-1);
    }
    if (action === 'next-chunk') {
      changeChunk(1);
    }
  });
});

function renderReader() {
  ensureSelection();
  persistProgress();
  const chapter = BOOKS[state.chapterId];
  const section = getSection();
  const point = getPoint();
  if (!chapter || !section || !point) {
    readerTitle.textContent = 'Содержимое недоступно';
    readerChapter.textContent = '';
    readerText.innerHTML = '';
    return;
  }

  readerTitle.textContent = chapter.title;
  readerChapter.textContent = point.title || section.title || chapter.title;
  readerText.innerHTML = '';

  const paragraphs = Array.isArray(point.text) && point.text.length
    ? point.text
    : ['Этот пункт ещё недоступен. Откройте его в магазине.'];

  paragraphs.forEach((paragraph, index) => {
    const p = document.createElement('p');
    p.textContent = paragraph;
    if (index !== state.chunkIndex) {
      p.classList.add('hidden');
    }
    readerText.appendChild(p);
  });

  readerProgress.style.width = paragraphs.length
    ? `${((state.chunkIndex + 1) / paragraphs.length) * 100}%`
    : '0%';

  if (state.autoVoice && paragraphs[state.chunkIndex]) {
    speak(paragraphs[state.chunkIndex]);
  }

  console.info(
    '[Reader] Отрисован фрагмент: глава=%s, раздел=%s, пункт=%s, абзацев=%d, активный=%d',
    state.chapterId,
    state.sectionId,
    state.pointId,
    paragraphs.length,
    state.chunkIndex + 1
  );
}

renderFontList();
applyStyle();
updateAutoVoiceButton();
initializeReader();

function initializeReader() {
  console.info('[Reader] Запуск инициализации данных книги');
  loadBookData()
    .then((data) => {
      BOOKS = data.books ?? {};
      chapterOrder = Array.isArray(data.chapters) ? data.chapters.map((chapter) => chapter.id) : [];

      if (!state.chapterId && data.defaultChapterId) {
        state.chapterId = data.defaultChapterId;
      }
      if (!state.sectionId && data.defaultSectionId) {
        state.sectionId = data.defaultSectionId;
      }
      if (!state.pointId && data.defaultPointId) {
        state.pointId = data.defaultPointId;
        console.info('[Reader] Дефолтный пункт: %s', data.defaultPointId);
      }

      readerRoot.dataset.defaultChapter = data.defaultChapterId ?? '';
      readerRoot.dataset.defaultSection = data.defaultSectionId ?? '';
      readerRoot.dataset.defaultPoint = data.defaultPointId ?? '';

      ensureSelection();
      renderReader();
      console.info('[Reader] Инициализация завершена: глав=%d, текущая=%s', chapterOrder.length, state.chapterId);
    })
    .catch((error) => {
      console.error('[Reader] failed to load book data', error);
      readerTitle.textContent = 'Load error';
      readerChapter.textContent = '';
      readerText.innerHTML = '';
      const paragraph = document.createElement('p');
      paragraph.textContent = 'Unable to load book content. Please refresh the page.';
      readerText.appendChild(paragraph);
    });
}

function loadPersistedProgress() {
  try {
    const raw = localStorage.getItem(READER_PROGRESS_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    console.info(
      '[Reader] Найден сохранённый прогресс: %s / %s / %s (фрагмент %s)',
      data.chapterId ?? '∅',
      data.sectionId ?? '∅',
      data.pointId ?? '∅',
      Number.isFinite(data.chunkIndex) ? data.chunkIndex + 1 : '∅'
    );
    return data;
  } catch (error) {
    console.warn('[Reader] Не удалось прочитать сохранённый прогресс', error);
    return null;
  }
}

function persistProgress() {
  try {
    const payload = {
      chapterId: state.chapterId,
      sectionId: state.sectionId,
      pointId: state.pointId,
      chunkIndex: state.chunkIndex,
      timestamp: Date.now(),
    };
    localStorage.setItem(READER_PROGRESS_KEY, JSON.stringify(payload));
    console.info(
      '[Reader] Прогресс сохранён: %s / %s / %s (фрагмент %d)',
      payload.chapterId,
      payload.sectionId,
      payload.pointId,
      payload.chunkIndex + 1
    );
  } catch (error) {
    console.warn('[Reader] Не удалось сохранить прогресс', error);
  }
}
