import { showToast } from './common.js';
import { loadBookData } from './book-data.js';

const READER_PROGRESS_KEY = 'mask2077:reader-progress';
const READER_PREFERENCES_KEY = 'mask2077:reader-preferences';
const FONT_OPTIONS = [
  { id: 'alice', label: 'Alice', css: "'Alice', serif" },
  { id: 'droid-serif', label: 'Droid Serif', css: "'Droid Serif', serif" },
  { id: 'roboto', label: 'Roboto', css: "'Roboto', sans-serif" },
  { id: 'rt-sans', label: 'RT Sans', css: "'PT Sans', sans-serif" },
  { id: 'comfortaa', label: 'Comfortaa', css: "'Comfortaa', cursive" },
];
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const MIN_LINE_HEIGHT = 1.0;
const MAX_LINE_HEIGHT = 2.0;
const FONT_WEIGHT_MIN = 300;
const FONT_WEIGHT_MAX = 900;
const FONT_WEIGHT_STEP = 100;
const DEFAULT_STYLE = {
  fontId: 'roboto',
  fontSize: 24,
  lineHeight: 1.0,
  fontWeight: 500,
  theme: 'sepia',
};

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

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolveFontOption(fontId) {
  if (!fontId) {
    return null;
  }
  return FONT_OPTIONS.find((option) => option.id === fontId) ?? null;
}

function normalizeFontWeight(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_STYLE.fontWeight;
  }
  const rounded = Math.round(value / FONT_WEIGHT_STEP) * FONT_WEIGHT_STEP;
  return clampValue(rounded, FONT_WEIGHT_MIN, FONT_WEIGHT_MAX);
}

function scheduleReaderRender() {
  if (renderScheduled) {
    return;
  }
  renderScheduled = true;
  const runner = window.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
  runner(() => {
    renderScheduled = false;
    renderReader();
  });
}

let BOOKS = {};
let chapterOrder = [];
let renderScheduled = false;

const readerRoot = document.querySelector('.reader');
if (!readerRoot) {
  console.warn('[Reader] root element not found');
  throw new Error('Reader root not found');
}

console.info('[Reader] Страница чтения активирована');

const readerText = document.getElementById('reader-text');
const readerProgress = document.getElementById('reader-progress');
const readerContentCurrent = readerRoot.querySelector('.reader__content_current');
const readerContentPrev = readerRoot.querySelector('.reader__content_prev');
const readerContentNext = readerRoot.querySelector('.reader__content_next');
const readerTextInner = readerText?.querySelector('.reader__text-inner') ?? null;
const readerBody = readerText?.querySelector('.reader__body') ?? null;

function createPaneRefs(container, overrides = {}) {
  if (!container) {
    return null;
  }
  return {
    container,
    text: overrides.text ?? container.querySelector('.reader__text-inner') ?? container.querySelector('.reader__text'),
    body: overrides.body ?? container.querySelector('.reader__body'),
  };
}

const paneCurrent = createPaneRefs(readerContentCurrent, {
  text: readerTextInner,
  body: readerBody,
});
const panePrev = createPaneRefs(readerContentPrev, {
  text: readerContentPrev?.querySelector('.reader__text-inner') ?? null,
  body: readerContentPrev?.querySelector('.reader__body') ?? null,
});
const paneNext = createPaneRefs(readerContentNext, {
  text: readerContentNext?.querySelector('.reader__text-inner') ?? null,
  body: readerContentNext?.querySelector('.reader__body') ?? null,
});
const readerControls = Array.from(readerRoot.querySelectorAll('.reader__controls'));
const stylePopup = document.getElementById('style-popup');
const fontList = document.getElementById('font-list');
const fontOverlay = document.getElementById('font-overlay');
const fontTrigger = document.getElementById('font-trigger');
const currentFontLabel = document.getElementById('current-font-label');
let controlsHidden = false;

if (stylePopup) {
  stylePopup.hidden = true;
}

const urlParams = new URLSearchParams(window.location.search);
const datasetDefaults = {
  chapter: readerRoot.dataset.defaultChapter || null,
  section: readerRoot.dataset.defaultSection || null,
  point: readerRoot.dataset.defaultPoint || null,
};

function setControlsVisibility(hidden) {
  controlsHidden = hidden;
  readerRoot.classList.toggle('reader--controls-hidden', hidden);
  readerControls.forEach((panel) => {
    panel.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  });
}

function createChunkPart(text, continuation = false, variant = null) {
  return {
    text: typeof text === 'string' ? text : '',
    continuation: Boolean(continuation),
    variant,
  };
}

function createContentElement(part, { attachId = false } = {}) {
  const variant = part.variant ?? null;
  let element;
  if (variant === 'title') {
    element = document.createElement('h1');
    element.className = 'reader__title';
    if (attachId) {
      element.id = 'reader-title';
    }
  } else if (variant === 'chapter') {
    element = document.createElement('p');
    element.className = 'reader__chapter';
    if (attachId) {
      element.id = 'reader-chapter';
    }
  } else {
    element = document.createElement('p');
  }
  element.textContent = part.text;
  if (part.continuation) {
    element.classList.add('reader__paragraph--continued');
  }
  return element;
}

function chunkToSpeechText(chunk) {
  if (!Array.isArray(chunk) || !chunk.length) {
    return '';
  }
  return chunk.reduce((acc, part, index) => {
    if (!part || typeof part.text !== 'string') {
      return acc;
    }
    if (index > 0) {
      acc += part.continuation ? ' ' : '\n\n';
    }
    acc += part.text;
    return acc;
  }, '');
}

function renderChunkIntoPane(pane, chunk, { ariaHidden = false } = {}) {
  if (!pane) {
    return;
  }
  const { container, body, text } = pane;
  container?.setAttribute('aria-hidden', ariaHidden ? 'true' : 'false');
  const target = body ?? text;
  if (!target) {
    return;
  }
  target.innerHTML = '';
  if (!Array.isArray(chunk) || !chunk.length) {
    return;
  }
  const fragment = document.createDocumentFragment();
  const attachIds = pane.container === readerContentCurrent;
  chunk.forEach((part) => {
    if (!part || typeof part.text !== 'string') {
      return;
    }
    const element = createContentElement(part, { attachId: attachIds });
    fragment.appendChild(element);
  });
  target.appendChild(fragment);
  if (!ariaHidden) {
    console.info(
      '[Reader] chunk render target metrics: client=%d offset=%d scroll=%d parts=%d',
      target.clientHeight,
      target.offsetHeight,
      target.scrollHeight,
      chunk.length
    );
  }
}

setControlsVisibility(true);

readerContentCurrent?.addEventListener('click', (event) => {
  if (event.defaultPrevented) {
    return;
  }
  const selection = window.getSelection?.();
  if (selection && selection.type === 'Range' && selection.toString().trim()) {
    return;
  }
  setControlsVisibility(!controlsHidden);
});
const persistedProgress = loadPersistedProgress();
const persistedPreferences = loadPersistedPreferences();
const persistedStyle = persistedPreferences?.style ?? {};
const initialFont =
  resolveFontOption(persistedStyle.fontId) ??
  resolveFontOption(DEFAULT_STYLE.fontId) ??
  FONT_OPTIONS[0];
const initialFontSize = Number.isFinite(Number(persistedStyle.fontSize))
  ? clampValue(Number(persistedStyle.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE)
  : DEFAULT_STYLE.fontSize;
const initialLineHeight = Number.isFinite(Number(persistedStyle.lineHeight))
  ? clampValue(Number(persistedStyle.lineHeight), MIN_LINE_HEIGHT, MAX_LINE_HEIGHT)
  : DEFAULT_STYLE.lineHeight;
const initialFontWeight = normalizeFontWeight(Number(persistedStyle.fontWeight));
const initialTheme = THEME_PRESETS[persistedStyle.theme] ? persistedStyle.theme : DEFAULT_STYLE.theme;
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
    font: initialFont,
    fontSize: initialFontSize,
    lineHeight: initialLineHeight,
    fontWeight: initialFontWeight,
    theme: initialTheme,
  },
  chunks: [],
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
  if (!Array.isArray(point?.text) || !point.text.length) {
    state.chunkIndex = 0;
    console.info('[Reader] point has no paragraphs: %s', state.pointId);
    return;
  }
  if (!Number.isFinite(state.chunkIndex) || state.chunkIndex < 0) {
    console.info('[Reader] chunk index normalized to zero for point=%s', state.pointId);
    state.chunkIndex = 0;
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
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(state.style.font.id === option.id));
    button.addEventListener('click', () => {
      state.style.font = option;
      console.info('[Reader] ��࠭ ����: %s', option.label);
      applyStyle();
      renderFontList();
      closeFontOverlay();
    });
    fontList.appendChild(button);
  });
  updateFontTriggerState();
}


function updateFontTriggerState() {
  if (currentFontLabel) {
    currentFontLabel.textContent = state.style.font.label;
  }
  if (fontTrigger) {
    const expanded = fontOverlay ? !fontOverlay.hidden : false;
    fontTrigger.setAttribute('aria-expanded', String(expanded));
  }
}

function openFontOverlay() {
  if (!fontOverlay) {
    return;
  }
  fontOverlay.hidden = false;
  updateFontTriggerState();
  console.info('[Reader] ������ ����: �������� ������ ������');
}

function closeFontOverlay() {
  if (!fontOverlay) {
    return;
  }
  if (fontOverlay.hidden) {
    updateFontTriggerState();
    return;
  }
  fontOverlay.hidden = true;
  updateFontTriggerState();
  console.info('[Reader] ������ ����: �������� ������ ������');
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

  persistPreferences();
  scheduleReaderRender();
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
  const chunks = Array.isArray(state.chunks) ? state.chunks : [];
  const currentIndex = state.chunkIndex;
  const total = chunks.length;
  console.info('[Reader] chunk change requested: direction=%d current=%d total=%d', direction, currentIndex + 1, total);
  if (!chunks.length) {
    console.warn('[Reader] chunk change skipped: no chunks available');
    return;
  }
  const nextIndex = clampValue(currentIndex + direction, 0, total - 1);
  if (nextIndex === currentIndex) {
    console.info('[Reader] chunk change skipped: boundary reached (index=%d of %d)', currentIndex + 1, total);
    return;
  }
  state.chunkIndex = nextIndex;
  console.info('[Reader] chunk change applied: previous=%d next=%d total=%d', currentIndex + 1, nextIndex + 1, total);
  renderReader();
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
  const chunks = Array.isArray(state.chunks) ? state.chunks : [];
  const chunk = chunks[state.chunkIndex];
  if (state.autoVoice && Array.isArray(chunk) && chunk.length) {
    const speechText = chunkToSpeechText(chunk);
    if (speechText) {
      speak(speechText);
    }
  }
}

function openStylePopup() {
  if (!stylePopup) return;
  stylePopup.hidden = false;
  closeFontOverlay();
  console.info('[Reader] �⨫�: ����� �����');
  const opener = readerRoot.querySelector('[data-action="open-style"]');
  opener?.setAttribute('aria-expanded', 'true');
  updateFontTriggerState();
}


function closeStylePopup() {
  if (!stylePopup) return;
  stylePopup.hidden = true;
  closeFontOverlay();
  console.info('[Reader] �⨫�: ����� ������');
  const opener = readerRoot.querySelector('[data-action="open-style"]');
  opener?.setAttribute('aria-expanded', 'false');
}


function adjustFontSize(delta) {
  const previous = state.style.fontSize;
  state.style.fontSize = clampValue(previous + delta, MIN_FONT_SIZE, MAX_FONT_SIZE);
  if (state.style.fontSize === previous) {
    console.info('[Reader] ������ ���� ���⨣ �।���: %d', previous);
    return;
  }
  applyStyle();
  console.info('[Reader] ������ ���� ������: %d', state.style.fontSize);
}


function adjustLineHeight(delta) {
  const previous = state.style.lineHeight;
  state.style.lineHeight = clampValue(previous + delta, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT);
  if (Math.abs(state.style.lineHeight - previous) < 0.001) {
    console.info('[Reader] �������� ���ࢠ� ���⨣ �।���: %d%%', Math.round(previous * 100));
    return;
  }
  applyStyle();
  console.info('[Reader] �������� ���ࢠ� ������: %d%%', Math.round(state.style.lineHeight * 100));
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
    case 'open-fonts':
      event?.preventDefault?.();
      openFontOverlay();
      break;
    case 'close-fonts':
      event?.preventDefault?.();
      closeFontOverlay();
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
  if (fontOverlay && !fontOverlay.hidden && event.target === fontOverlay) {
    console.info('[Reader] ������ ����: �������� �� �������� ������');
    closeFontOverlay();
    return;
  }
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
  state.style.fontWeight = normalizeFontWeight(Number(fontWeightInput.value));
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

function buildChunks(paragraphs, options = {}) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) {
    return [];
  }
  const textHost = paneCurrent?.text ?? null;
  const bodyHost = paneCurrent?.body ?? null;
  const measurementHost = bodyHost ?? textHost;
  if (!measurementHost) {
    return paragraphs.map((paragraph) => [createChunkPart(String(paragraph ?? ''))]);
  }
  const computed = window.getComputedStyle(measurementHost);
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;

  console.info(
    '[Reader] measurement host metrics: client=%d offset=%d paddingT=%d paddingB=%d paddingL=%d paddingR=%d',
    measurementHost.clientHeight,
    measurementHost.offsetHeight,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight
  );

  const viewportHeight = Math.max(0, measurementHost.clientHeight - paddingTop - paddingBottom);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return paragraphs.map((paragraph) => [createChunkPart(String(paragraph ?? ''))]);
  }

  const SAFETY_OFFSET = 24;
  const TEXT_BUFFER = 32;
  const baseLimit = Math.ceil(viewportHeight);
  let viewportLimit = baseLimit;

  console.info(
    '[Reader] buildChunks start: paragraphs=%d viewportHeight=%d baseLimit=%d safety=%d hostClient=%d hostOffset=%d bodyClient=%d bodyOffset=%d',
    paragraphs.length,
    Math.round(viewportHeight),
    baseLimit,
    SAFETY_OFFSET,
    measurementHost.clientHeight,
    measurementHost.offsetHeight,
    bodyHost?.clientHeight ?? -1,
    bodyHost?.offsetHeight ?? -1
  );

  const measurement = document.createElement('div');
  measurement.className = 'reader__text--measure';
  measurement.style.setProperty('position', 'static', 'important');
  measurement.style.setProperty('inset', 'auto', 'important');
  measurement.style.setProperty('top', 'auto', 'important');
  measurement.style.setProperty('bottom', 'auto', 'important');
  measurement.style.setProperty('left', 'auto', 'important');
  measurement.style.setProperty('right', 'auto', 'important');
  measurement.style.paddingTop = `${paddingTop}px`;
  measurement.style.paddingBottom = `${paddingBottom}px`;
  measurement.style.paddingLeft = `${paddingLeft}px`;
  measurement.style.paddingRight = `${paddingRight}px`;
  measurement.style.flex = '0 0 auto';
  measurement.setAttribute('aria-hidden', 'true');
  measurementHost.appendChild(measurement);

  const chunks = [];
  let currentChunk = [];
  const prefixParts = Array.isArray(options.prefixParts)
    ? options.prefixParts.filter((part) => part && typeof part.text === 'string' && part.text.length)
    : [];
  let prefixApplied = false;

  const clonePart = (part) => ({
    text: part.text,
    continuation: part.continuation,
    variant: part.variant,
  });

  const resetMeasurement = (preserveCurrent = false) => {
    measurement.innerHTML = '';
    if (preserveCurrent && currentChunk.length) {
      currentChunk.forEach((existingPart) => {
        const mount = createContentElement(existingPart);
        measurement.appendChild(mount);
      });
    }
  };

  const flushChunk = () => {
    if (!currentChunk.length) {
      resetMeasurement();
      return;
    }
    console.info('[Reader] chunk finalized: partCount=%d totalChunks=%d', currentChunk.length, chunks.length + 1);
    chunks.push(currentChunk.map(clonePart));
    currentChunk = [];
    resetMeasurement();
  };

  const appendNode = (part) => {
    const node = createContentElement(part);
    measurement.appendChild(node);
    return node;
  };

  const applyPrefix = () => {
    if (prefixApplied || !prefixParts.length) {
      return;
    }
    console.info('[Reader] applying prefix parts: total=%d', prefixParts.length);
    prefixParts.forEach((part, idx) => {
      currentChunk.push(part);
      appendNode(part);
      console.info(
        '[Reader] prefix part[%d]: variant=%s length=%d text=%s',
        idx,
        part.variant ?? 'text',
        part.text.length,
        part.text.slice(0, 80)
      );
    });
    prefixApplied = true;
  };

  applyPrefix();
  const prefixHeight = Math.ceil(measurement.scrollHeight);
  viewportLimit = Math.max(prefixHeight, baseLimit - SAFETY_OFFSET);
  const allowableScroll = Math.max(prefixHeight, viewportLimit - TEXT_BUFFER);
  console.info(
    '[Reader] measurement initial scroll=%d prefix=%d baseLimit=%d effectiveLimit=%d allowableScroll=%d',
    prefixHeight,
    prefixHeight,
    baseLimit,
    viewportLimit,
    allowableScroll
  );

  const fitsViewport = () => Math.ceil(measurement.scrollHeight) <= allowableScroll;

  const tryAppendPart = (part) => {
    const node = appendNode(part);
    const currentScroll = Math.ceil(measurement.scrollHeight);
    if (fitsViewport()) {
      currentChunk.push(part);
      console.info(
        '[Reader] part appended: variant=%s length=%d scroll=%d limit=%d allowable=%d totalParts=%d',
        part.variant ?? 'text',
        part.text.length,
        currentScroll,
        viewportLimit,
        allowableScroll,
        currentChunk.length
      );
      return true;
    }
    console.info(
      '[Reader] part overflow: variant=%s length=%d scroll=%d limit=%d allowable=%d',
      part.variant ?? 'text',
      part.text.length,
      currentScroll,
      viewportLimit,
      allowableScroll
    );
    node.remove();
    return false;
  };

  const findSplitBoundary = (text, candidateLength) => {
    const boundaryChars = new Set([' ', '\t', '\n', '\r', '.', ',', ';', ':', '!', '?', '-', '\u2013', '\u2014', ')']);
    const maxOffset = Math.min(80, text.length);
    for (let offset = 0; offset < maxOffset; offset += 1) {
      const leftIndex = candidateLength - offset - 1;
      if (leftIndex > 0 && boundaryChars.has(text[leftIndex])) {
        return leftIndex + 1;
      }
    }
    for (let offset = 0; offset < maxOffset; offset += 1) {
      const rightIndex = candidateLength + offset;
      if (rightIndex < text.length && boundaryChars.has(text[rightIndex])) {
        return rightIndex + 1;
      }
    }
    return candidateLength;
  };

  const fitsStandalone = (text) => {
    resetMeasurement(true);
    const node = appendNode(createChunkPart(text));
    const fits = fitsViewport();
    node.remove();
    resetMeasurement(true);
    return fits;
  };

  const splitParagraph = (text) => {
    const segments = [];
    let remainder = text;
    let splitIteration = 0;
    while (remainder.length) {
      splitIteration += 1;
      let low = 1;
      let high = remainder.length;
      let bestLength = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = remainder.slice(0, mid);
        if (!candidate.trim()) {
          low = mid + 1;
          continue;
        }
        if (fitsStandalone(candidate)) {
          bestLength = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      if (bestLength <= 0) {
        bestLength = 1;
      } else {
        const adjusted = findSplitBoundary(remainder, bestLength);
        if (adjusted !== bestLength) {
          const candidate = remainder.slice(0, adjusted);
          if (fitsStandalone(candidate)) {
            bestLength = adjusted;
          }
        }
      }
      const segment = remainder.slice(0, bestLength);
      console.info(
        '[Reader] split iteration=%d best=%d segmentLen=%d remaining=%d',
        splitIteration,
        bestLength,
        segment.length,
        Math.max(remainder.length - bestLength, 0)
      );
      if (segment.trim().length === 0) {
        break;
      }
      segments.push(segment);
      remainder = remainder.slice(bestLength).replace(/^\s+/u, ' ');
    }
    resetMeasurement(true);
    console.info('[Reader] split result: totalSegments=%d originalLength=%d', segments.length, text.length);
    return segments;
  };

  paragraphs.forEach((rawParagraph) => {
    const paragraph = typeof rawParagraph === 'string' ? rawParagraph : String(rawParagraph ?? '');
    if (!paragraph) {
      const emptyPart = createChunkPart('');
      if (!tryAppendPart(emptyPart)) {
        flushChunk();
        tryAppendPart(emptyPart);
      }
      return;
    }
    const initialPart = createChunkPart(paragraph);
    if (tryAppendPart(initialPart)) {
      return;
    }
    if (currentChunk.length) {
      flushChunk();
      applyPrefix();
      if (tryAppendPart(initialPart)) {
        return;
      }
    }

    resetMeasurement(true);
    const segments = splitParagraph(paragraph);
    if (!segments.length) {
      const fallbackPart = createChunkPart(paragraph);
      if (!tryAppendPart(fallbackPart)) {
        flushChunk();
        applyPrefix();
        tryAppendPart(fallbackPart);
      }
      return;
    }
    segments.forEach((segment, index) => {
      const cleaned = index === 0 ? segment.replace(/\s+$/u, '') : segment.trim();
      if (!cleaned) {
        return;
      }
      const part = createChunkPart(cleaned, index > 0);
      if (!tryAppendPart(part)) {
        flushChunk();
        applyPrefix();
        if (!tryAppendPart(part)) {
          const forcedChars = Array.from(part.text);
          forcedChars.forEach((char, charIndex) => {
            const forcedPart = createChunkPart(char, part.continuation || charIndex > 0);
            if (!tryAppendPart(forcedPart)) {
              flushChunk();
              applyPrefix();
              tryAppendPart(forcedPart);
            }
          });
        }
      }
    });
  });

  if (currentChunk.length) {
    chunks.push(currentChunk.map(clonePart));
  }

  measurement.remove();
  if (prefixParts.length && chunks.length > 1) {
    const isHeading = (part) => part.variant === 'title' || part.variant === 'chapter';
    const firstChunk = chunks[0];
    let hasNonHeading = firstChunk.some((part) => !isHeading(part));
    if (!hasNonHeading) {
      const donorChunk = chunks[1];
      while (donorChunk.length) {
        const moved = donorChunk.shift();
        firstChunk.push(moved);
        if (!isHeading(moved)) {
          hasNonHeading = true;
          break;
        }
      }
      if (!donorChunk.length) {
        chunks.splice(1, 1);
      }
    }
  }
  console.info('[Reader] buildChunks result: chunks=%d', chunks.length);
  return chunks.length ? chunks : [[createChunkPart('')]];
}

function renderReader() {
  ensureSelection();
  const { chapterId, sectionId, pointId, chunkIndex } = state;
  console.info('[Reader] render start: chapter=%s section=%s point=%s chunkIndex=%d', chapterId ?? 'n/a', sectionId ?? 'n/a', pointId ?? 'n/a', chunkIndex + 1);

  const chapter = BOOKS[chapterId];
  const section = getSection();
  const point = getPoint();
  if (!chapter || !section || !point) {
    if (!chapterOrder.length) {
      console.warn('[Reader] render aborted: chapter order is empty');
      return;
    }
    const fallbackChunk = [
      createChunkPart('Content unavailable', false, 'title'),
      createChunkPart('Unable to resolve the requested chapter or section.'),
    ];
    renderChunkIntoPane(paneCurrent, fallbackChunk, { ariaHidden: false });
    renderChunkIntoPane(panePrev, [], { ariaHidden: true });
    renderChunkIntoPane(paneNext, [], { ariaHidden: true });
    readerProgress.style.width = '0%';
    state.chunks = [];
    console.warn('[Reader] render aborted: missing chapter/section/point data');
    return;
  }

  const rawParagraphs = Array.isArray(point.text) && point.text.length
    ? point.text
    : ['No text available for this point.'];
  console.info(
    '[Reader] render paragraphs: count=%d firstLen=%d sample=%s',
    rawParagraphs.length,
    rawParagraphs[0]?.length ?? 0,
    (rawParagraphs[0] ?? '').slice(0, 120)
  );

  const titleText = chapter.title ?? '';
  const chapterText = point.title || section.title || chapter.title || '';
  const headingParts = [];
  if (titleText) {
    headingParts.push(createChunkPart(titleText, false, 'title'));
  }
  if (chapterText && chapterText !== titleText) {
    headingParts.push(createChunkPart(chapterText, false, 'chapter'));
  }

  const chunks = buildChunks(rawParagraphs, { prefixParts: headingParts });
  console.info(
    '[Reader] chunks prepared summary: %s',
    JSON.stringify(
      chunks.map((chunk, idx) => ({
        index: idx + 1,
        parts: chunk.length,
        variants: chunk.map((part) => part.variant ?? 'text'),
      }))
    )
  );
  if (chunks.length) {
    const firstVariants = chunks[0].map((part) => part.variant ?? 'text');
    const nonHeading = chunks[0].filter((part) => (part.variant ?? 'text') === 'text');
    console.info('[Reader] first chunk detail: variants=%s textParts=%d', JSON.stringify(firstVariants), nonHeading.length);
  }
  if (!chunks.length) {
    chunks.push([createChunkPart('No chunks generated.')]);
  }
  console.info('[Reader] render chunks prepared: total=%d requestedIndex=%d', chunks.length, chunkIndex + 1);

  state.chunks = chunks;
  const maxIndex = Math.max(chunks.length - 1, 0);
  const previousIndex = state.chunkIndex;
  state.chunkIndex = clampValue(previousIndex, 0, maxIndex);
  if (state.chunkIndex !== previousIndex) {
    console.info('[Reader] render index corrected: previous=%d current=%d total=%d', previousIndex + 1, state.chunkIndex + 1, chunks.length);
  }

  const activeChunk = chunks[state.chunkIndex] ?? [];
  const previousChunk = state.chunkIndex > 0 ? chunks[state.chunkIndex - 1] : [];
  const nextChunk = state.chunkIndex < chunks.length - 1 ? chunks[state.chunkIndex + 1] : [];
  console.info('[Reader] render chunk sizes: previous=%d current=%d next=%d', previousChunk.length, activeChunk.length, nextChunk.length);

  renderChunkIntoPane(paneCurrent, activeChunk, { ariaHidden: false });
  renderChunkIntoPane(panePrev, previousChunk, { ariaHidden: true });
  renderChunkIntoPane(paneNext, nextChunk, { ariaHidden: true });

  console.info(
    '[Reader] chunk metrics: total=%d currentParts=%d prevParts=%d nextParts=%d',
    chunks.length,
    activeChunk.length,
    previousChunk.length,
    nextChunk.length
  );
  const currentBody = paneCurrent.body;
  const currentInner = paneCurrent.text;
  const currentText = currentInner?.parentElement ?? null;
  if (currentBody && currentInner && currentText) {
    console.info(
      '[Reader] layout metrics: text={client:%d,offset:%d} inner={client:%d,offset:%d,scroll:%d} body={client:%d,offset:%d,scroll:%d}',
      currentText.clientHeight,
      currentText.offsetHeight,
      currentInner.clientHeight,
      currentInner.offsetHeight,
      currentInner.scrollHeight,
      currentBody.clientHeight,
      currentBody.offsetHeight,
      currentBody.scrollHeight
    );
  }

  const progressValue = chunks.length
    ? ((state.chunkIndex + 1) / chunks.length) * 100
    : 0;
  readerProgress.style.width = `${progressValue}%`;
  console.info('[Reader] render progress updated: value=%d%%', Math.round(progressValue));

  if (state.autoVoice && activeChunk.length) {
    const speechText = chunkToSpeechText(activeChunk);
    if (speechText) {
      console.info('[Reader] render auto-voice triggered for chunk length=%d', activeChunk.length);
      speak(speechText);
    }
  }

  persistProgress();

  console.info(
    '[Reader] render complete: chapter=%s section=%s point=%s chunks=%d current=%d',
    state.chapterId,
    state.sectionId,
    state.pointId,
    chunks.length,
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
      const fallbackChunk = [
        createChunkPart('Load error', false, 'title'),
        createChunkPart('Unable to load book content. Please refresh the page.'),
      ];
      renderChunkIntoPane(paneCurrent, fallbackChunk, {
        ariaHidden: false,
      });
      renderChunkIntoPane(panePrev, [], { ariaHidden: true });
      renderChunkIntoPane(paneNext, [], { ariaHidden: true });
      readerProgress.style.width = '0%';
      state.chunks = [];
      state.chunkIndex = 0;
    });
}

function loadPersistedPreferences() {
  try {
    const raw = localStorage.getItem(READER_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    console.info('[Reader] ������ ����: �������� ��������� ��������');
    return data;
  } catch (error) {
    console.warn('[Reader] �� 㤠���� �������� ��������', error);
    return null;
  }
}

function persistPreferences() {
  try {
    const payload = {
      style: {
        fontId: state.style.font.id,
        fontSize: state.style.fontSize,
        lineHeight: state.style.lineHeight,
        fontWeight: state.style.fontWeight,
        theme: state.style.theme,
      },
      timestamp: Date.now(),
    };
    localStorage.setItem(READER_PREFERENCES_KEY, JSON.stringify(payload));
    console.info('[Reader] ������ ����: ���������� ��������');
  } catch (error) {
    console.warn('[Reader] �� 㤠���� ���������� ��������', error);
  }
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
