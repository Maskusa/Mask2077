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
    surface: 'rgba(255, 255, 255, 0.94)',
    border: 'rgba(209, 140, 45, 0.28)',
  },
  night: {
    text: '#f2f6ff',
    backdrop: 'linear-gradient(135deg, #172033, #050b16)',
    surface: 'rgba(12, 20, 36, 0.78)',
    border: 'rgba(82, 142, 255, 0.28)',
  },
  'night-contrast': {
    text: '#fefefe',
    backdrop: 'linear-gradient(135deg, #1c1d3b, #011221)',
    surface: 'rgba(6, 12, 28, 0.82)',
    border: 'rgba(120, 170, 255, 0.32)',
  },
  sepia: {
    text: '#3a1a00',
    backdrop: 'linear-gradient(135deg, #fff1d0, #f7d5a3)',
    surface: 'rgba(255, 244, 222, 0.92)',
    border: 'rgba(163, 104, 44, 0.26)',
  },
  'sepia-contrast': {
    text: '#2b1700',
    backdrop: 'linear-gradient(135deg, #ffe6bb, #eec37a)',
    surface: 'rgba(252, 232, 198, 0.92)',
    border: 'rgba(133, 82, 24, 0.3)',
  },
  dusk: {
    text: '#361b44',
    backdrop: 'linear-gradient(135deg, #f7def7, #a8c8ff)',
    surface: 'rgba(249, 241, 255, 0.9)',
    border: 'rgba(120, 84, 195, 0.24)',
  },
  console: {
    text: '#21ff88',
    backdrop: 'linear-gradient(135deg, #001924, #002c38)',
    surface: 'rgba(0, 26, 40, 0.8)',
    border: 'rgba(33, 255, 136, 0.24)',
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

const readerViewport = document.getElementById('reader-viewport');
const readerPageShell = document.getElementById('reader-page');
const readerFlow = document.getElementById('reader-flow');
const layoutInfo = document.getElementById('reader-layout-info');
const readerProgress = document.getElementById('reader-progress');
const readerControls = Array.from(readerRoot.querySelectorAll('.reader__controls'));
const stylePopup = document.getElementById('style-popup');
const fontList = document.getElementById('font-list');
const fontOverlay = document.getElementById('font-overlay');
const fontTrigger = document.getElementById('font-trigger');
const currentFontLabel = document.getElementById('current-font-label');
let controlsHidden = false;

const DEFAULT_COLUMN_GAP = 32;
const PAGE_TRANSITION_DURATION = 450;

if (!readerViewport || !readerPageShell || !readerFlow) {
  throw new Error('Reader viewport is not available');
}

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

function createChunkPart(text, continuation = false, variant = null, meta = null) {
  const chunk = {
    text: typeof text === 'string' ? text : '',
    continuation: Boolean(continuation),
    variant,
  };
  if (meta !== null && meta !== undefined) {
    chunk.meta = meta;
  }
  return chunk;
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
  const meta = part.meta;
  if (meta && typeof meta === 'object') {
    if (meta.chapterId) {
      element.dataset.chapterId = String(meta.chapterId);
    }
    if (meta.sectionId) {
      element.dataset.sectionId = String(meta.sectionId);
    }
    if (meta.pointId) {
      element.dataset.pointId = String(meta.pointId);
    }
    if (meta.type) {
      element.dataset.partType = String(meta.type);
    }
    if (meta.paragraphIndex !== undefined && meta.paragraphIndex !== null) {
      element.dataset.paragraphIndex = String(meta.paragraphIndex);
    }
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

setControlsVisibility(true);

readerPageShell?.addEventListener('click', (event) => {
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
const queryPage = Number(urlParams.get('page'));
const queryChunk = Number(urlParams.get('chunk'));
const persistedIndex = Number.isFinite(persistedProgress?.pageIndex)
  ? persistedProgress.pageIndex
  : Number.isFinite(persistedProgress?.chunkIndex)
  ? persistedProgress.chunkIndex
  : 0;
const initialPageIndex = Number.isFinite(queryPage)
  ? Math.max(0, queryPage)
  : Number.isFinite(queryChunk)
  ? Math.max(0, queryChunk)
  : Math.max(0, persistedIndex);
const state = {
  chapterId: urlParams.get('chapter') ?? persistedProgress?.chapterId ?? datasetDefaults.chapter,
  sectionId: urlParams.get('section') ?? persistedProgress?.sectionId ?? datasetDefaults.section,
  pointId: urlParams.get('point') ?? persistedProgress?.pointId ?? datasetDefaults.point,
  pageIndex: initialPageIndex,
  autoAlignPage: true,
  autoVoice: false,
  readerVoiceEnabled: true,
  style: {
    font: initialFont,
    fontSize: initialFontSize,
    lineHeight: initialLineHeight,
    fontWeight: initialFontWeight,
    theme: initialTheme,
  },
  flowParts: [],
  flowChapterId: null,
  pagination: null,
  paginationKey: null,
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

function getOrderedSectionIds(chapter) {
  if (!chapter || typeof chapter !== 'object' || !chapter.sections) {
    return [];
  }
  return Object.keys(chapter.sections);
}

function getOrderedPointIds(section) {
  if (!section || typeof section !== 'object' || !section.points) {
    return [];
  }
  return Object.keys(section.points);
}

function ensureSelection() {
  if (chapterOrder.length === 0) {
    return;
  }
  let resetPage = false;
  if (!state.chapterId || !BOOKS[state.chapterId]) {
    state.chapterId = chapterOrder[0];
    resetPage = true;
    console.info('[Reader] �ᯮ��㥬 ����� �� 㬮�砭��: %s', state.chapterId);
  }
  const chapter = BOOKS[state.chapterId];
  const sectionKeys = chapter ? Object.keys(chapter.sections) : [];
  if (!sectionKeys.length) {
    console.warn('[Reader] � ����� ��� ࠧ�����: %s', state.chapterId);
    state.sectionId = null;
    state.pointId = null;
    state.pageIndex = 0;
    state.autoAlignPage = true;
    return;
  }
  if (!state.sectionId || !chapter.sections[state.sectionId]) {
    state.sectionId = sectionKeys[0];
    resetPage = true;
    console.info('[Reader] �ᯮ��㥬 ࠧ��� �� 㬮�砭��: %s', state.sectionId);
  }
  const section = chapter.sections[state.sectionId];
  const pointKeys = section ? Object.keys(section.points) : [];
  if (!pointKeys.length) {
    console.warn('[Reader] � ࠧ���� ��� �㭪⮢: %s', state.sectionId);
    state.pointId = null;
    state.pageIndex = 0;
    state.autoAlignPage = true;
    return;
  }
  if (!state.pointId || !section.points[state.pointId]) {
    state.pointId = pointKeys[0];
    resetPage = true;
    console.info('[Reader] �ᯮ��㥬 �㭪� �� 㬮�砭��: %s', state.pointId);
  }
  const point = section.points[state.pointId];
  if (!Array.isArray(point?.text) || !point.text.length) {
    state.pageIndex = 0;
    state.autoAlignPage = true;
    console.info('[Reader] point has no paragraphs: %s', state.pointId);
    return;
  }
  if (!Number.isFinite(state.pageIndex) || state.pageIndex < 0) {
    console.info('[Reader] page index normalized to zero for point=%s', state.pointId);
    state.pageIndex = 0;
    state.autoAlignPage = true;
    return;
  }
  if (resetPage) {
    state.pageIndex = 0;
    state.autoAlignPage = true;
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
  readerRoot.style.setProperty('--reader-page-surface', preset.surface ?? 'rgba(255, 255, 255, 0.9)');
  readerRoot.style.setProperty('--reader-page-border', preset.border ?? 'rgba(0, 0, 0, 0.12)');

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

function changePage(direction) {
  const total = Number.isFinite(state.pagination?.totalPages) ? state.pagination.totalPages : 0;
  const currentIndex = clampValue(state.pageIndex, 0, Math.max(total - 1, 0));
  console.info('[Reader] page change requested: direction=%d current=%d total=%d', direction, currentIndex + 1, total);
  if (!total) {
    console.warn('[Reader] page change skipped: pagination not ready');
    return;
  }
  const nextIndex = clampValue(currentIndex + direction, 0, total - 1);
  if (nextIndex === currentIndex) {
    console.info('[Reader] page change skipped: boundary reached (index=%d of %d)', currentIndex + 1, total);
    return;
  }
  state.pageIndex = nextIndex;
  state.autoAlignPage = false;
  renderReader();
}


function toggleAutoVoice() {
  if (!speechSupported) {
    showToast('Голосовой модуль не доступен');
    return;
  }
  state.autoVoice = !state.autoVoice;
  if (!state.autoVoice) {
    stopSpeaking();
  }
  updateAutoVoiceButton();
  if (state.autoVoice) {
    const speechText = getVisiblePageText();
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
      changePage(-1);
      break;
    case 'next-chunk':
      event?.preventDefault?.();
      changePage(1);
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
      changePage(-1);
    }
    if (action === 'next-chunk') {
      changePage(1);
    }
  });
});


function ensureFlowParts(chapterId) {
  if (state.flowChapterId !== chapterId) {
    state.flowParts = buildChapterFlowParts(chapterId);
    state.flowChapterId = chapterId;
  }
  return state.flowParts;
}

function clearPaginationState() {
  state.pagination = null;
  state.paginationKey = null;
}

function getPaginationMetrics() {
  if (!readerPageShell || !readerFlow) {
    return null;
  }
  const shellStyle = window.getComputedStyle(readerPageShell);
  const paddingTop = Number.parseFloat(shellStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(shellStyle.paddingBottom) || 0;
  const paddingLeft = Number.parseFloat(shellStyle.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(shellStyle.paddingRight) || 0;
  const innerWidth = Math.max(0, readerPageShell.clientWidth - paddingLeft - paddingRight);
  const innerHeight = Math.max(0, readerPageShell.clientHeight - paddingTop - paddingBottom);
  const fontScale = Math.max(0.35, state.style.fontSize / DEFAULT_STYLE.fontSize);
  const columnGap = clampValue(Math.round(DEFAULT_COLUMN_GAP * Math.sqrt(fontScale)), 20, 72);
  const columnWidth = Math.max(1, innerWidth);
  const columnHeight = Math.max(1, innerHeight);
  return {
    measurementHost: readerPageShell,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    innerWidth,
    innerHeight,
    columnWidth,
    columnHeight,
    columnGap,
  };
}

function createPaginationKey(chapterId, metrics) {
  const { font, fontSize, lineHeight, fontWeight, theme } = state.style;
  return [
    chapterId ?? '',
    font?.id ?? '',
    fontSize,
    lineHeight.toFixed(4),
    fontWeight,
    theme,
    metrics?.columnWidth ?? 0,
    metrics?.columnHeight ?? 0,
    metrics?.columnGap ?? 0,
  ].join('|');
}

function buildPagination(flowParts, metrics) {
  if (!metrics?.measurementHost) {
    return null;
  }
  const measurement = document.createElement('div');
  measurement.className = 'reader__flow';
  measurement.style.position = 'absolute';
  measurement.style.inset = '0';
  measurement.style.visibility = 'hidden';
  measurement.style.pointerEvents = 'none';
  measurement.style.boxSizing = 'border-box';
  measurement.style.width = `${metrics.columnWidth}px`;
  measurement.style.height = `${metrics.columnHeight}px`;
  measurement.style.columnGap = `${metrics.columnGap}px`;
  measurement.style.columnWidth = `${metrics.columnWidth}px`;
  measurement.style.columnFill = 'auto';
  measurement.style.padding = '0';
  measurement.style.margin = '0';
  measurement.style.transform = 'none';
  measurement.style.transition = 'none';
  metrics.measurementHost.appendChild(measurement);

  const fragment = document.createDocumentFragment();
  flowParts.forEach((part) => {
    fragment.appendChild(createContentElement(part));
  });
  measurement.appendChild(fragment);

  const scrollWidth = Math.max(measurement.scrollWidth, metrics.columnWidth);
  const pageShiftWidth = metrics.columnWidth + metrics.columnGap;
  const rawPageCount = pageShiftWidth > 0 ? (scrollWidth + metrics.columnGap) / pageShiftWidth : 1;
  const totalPages = Math.max(1, Math.ceil(rawPageCount - 0.001));

  const anchorMap = {};
  const pageAnchors = new Array(totalPages).fill(null);
  const nodes = Array.from(measurement.children);
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const offset = node.offsetLeft;
    const pageIndex = pageShiftWidth > 0 ? Math.min(totalPages - 1, Math.floor(offset / pageShiftWidth)) : 0;
    const existing = pageAnchors[pageIndex] ?? { chapterId: null, sectionId: null, pointId: null };
    const { chapterId: metaChapter, sectionId: metaSection, pointId: metaPoint } = node.dataset;
    if (metaChapter && !existing.chapterId) {
      existing.chapterId = metaChapter;
    }
    if (metaSection && !existing.sectionId) {
      existing.sectionId = metaSection;
    }
    if (metaPoint && !existing.pointId) {
      existing.pointId = metaPoint;
    }
    pageAnchors[pageIndex] = existing;
    if (metaPoint && anchorMap[metaPoint] === undefined) {
      anchorMap[metaPoint] = pageIndex;
    }
  });

  const contentHTML = measurement.innerHTML;
  measurement.remove();

  return {
    totalPages,
    pageShiftWidth,
    columnWidth: metrics.columnWidth,
    columnHeight: metrics.columnHeight,
    columnGap: metrics.columnGap,
    scrollWidth,
    anchorMap,
    pageAnchors,
    contentHTML,
    version: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  };
}

function ensureFlowContent(pagination) {
  if (!readerFlow) {
    return;
  }
  if (readerFlow.dataset.contentVersion === pagination.version) {
    return;
  }
  readerFlow.innerHTML = pagination.contentHTML;
  readerFlow.dataset.contentVersion = pagination.version;
}

function applyLayout(pagination, metrics, { immediate = false } = {}) {
  if (!readerFlow) {
    return;
  }
  ensureFlowContent(pagination);
  const themeId = state.style.theme ?? '';
  const isDarkTheme = /night|console/.test(themeId);
  const ruleColor = isDarkTheme ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.08)';
  readerRoot.style.setProperty('--reader-column-gap', `${pagination.columnGap}px`);
  readerRoot.style.setProperty('--reader-column-width', `${pagination.columnWidth}px`);
  readerRoot.style.setProperty('--reader-column-rule', ruleColor);
  readerFlow.style.columnGap = `${pagination.columnGap}px`;
  readerFlow.style.columnWidth = `${pagination.columnWidth}px`;
  readerFlow.style.height = `${pagination.columnHeight}px`;
  const flowWidth = Math.max(pagination.scrollWidth, pagination.columnWidth);
  readerFlow.style.width = `${flowWidth}px`;
  readerFlow.style.transition = immediate ? 'none' : `transform ${PAGE_TRANSITION_DURATION}ms ease`;
}

function applyPageTransform(pagination, pageIndex, { immediate = false } = {}) {
  if (!readerFlow) {
    return;
  }
  const offset = Math.max(0, pageIndex) * pagination.pageShiftWidth;
  if (immediate) {
    readerFlow.style.transition = 'none';
    readerFlow.style.transform = `translateX(-${offset}px)`;
    void readerFlow.offsetHeight;
    readerFlow.style.transition = `transform ${PAGE_TRANSITION_DURATION}ms ease`;
  } else {
    readerFlow.style.transition = `transform ${PAGE_TRANSITION_DURATION}ms ease`;
    readerFlow.style.transform = `translateX(-${offset}px)`;
  }
  readerFlow.dataset.pageIndex = String(pageIndex);
}

function resolvePageAnchor(pagination, pageIndex) {
  if (!pagination?.pageAnchors || !pagination.pageAnchors.length) {
    return null;
  }
  for (let idx = pageIndex; idx >= 0; idx -= 1) {
    const anchor = pagination.pageAnchors[idx];
    if (anchor && (anchor.sectionId || anchor.pointId)) {
      return anchor;
    }
  }
  return pagination.pageAnchors[pageIndex] ?? null;
}

function getVisiblePageText() {
  if (!readerFlow || !readerPageShell) {
    return '';
  }
  const viewportRect = readerPageShell.getBoundingClientRect();
  const nodes = Array.from(readerFlow.querySelectorAll('h1, h2, h3, h4, p'));
  const pieces = [];
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const rect = node.getBoundingClientRect();
    if (rect.right <= viewportRect.left || rect.left >= viewportRect.right) {
      return;
    }
    if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) {
      return;
    }
    const text = node.textContent?.trim();
    if (text) {
      pieces.push(text);
    }
  });
  return pieces.join('\n\n');
}

function updateLayoutInfo(pagination, metrics) {
  if (!layoutInfo) {
    return;
  }
  if (!pagination || !metrics) {
    layoutInfo.dataset.visible = 'false';
    layoutInfo.hidden = true;
    layoutInfo.innerHTML = '';
    return;
  }
  const lines = [
    `pages: ${pagination.totalPages}`,
    `column: ${Math.round(pagination.columnWidth)}px`,
    `gap: ${Math.round(pagination.columnGap)}px`,
    `shift: ${Math.round(pagination.pageShiftWidth)}px`,
  ];
  layoutInfo.innerHTML = `<strong>Layout</strong><span>${lines.join('<br/>')}</span>`;
  const shouldReveal = layoutInfo.dataset.debug === 'true';
  layoutInfo.dataset.visible = shouldReveal ? 'true' : 'false';
  layoutInfo.hidden = !shouldReveal;
}

function renderFallbackContent(parts) {
  if (!readerFlow) {
    return;
  }
  readerFlow.innerHTML = '';
  if (Array.isArray(parts) && parts.length) {
    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (!part || typeof part.text !== 'string') {
        return;
      }
      fragment.appendChild(createContentElement(part));
    });
    readerFlow.appendChild(fragment);
  }
  readerFlow.style.transition = 'none';
  readerFlow.style.transform = 'translateX(0)';
  readerFlow.dataset.pageIndex = '0';
  readerFlow.dataset.contentVersion = 'fallback';
  readerFlow.style.width = '';
  readerFlow.style.height = '';
  readerFlow.style.columnWidth = '';
  readerFlow.style.columnGap = '';
  readerRoot.style.removeProperty('--reader-column-gap');
  readerRoot.style.removeProperty('--reader-column-width');
  readerRoot.style.removeProperty('--reader-column-rule');
  readerProgress.style.width = '0%';
  updateLayoutInfo(null, null);
  clearPaginationState();
}

function buildChapterFlowParts(chapterId) {
  const chapter = BOOKS[chapterId];
  if (!chapter) {
    return [];
  }

  const parts = [];
  if (chapter.title) {
    parts.push(
      createChunkPart(chapter.title, false, 'title', {
        chapterId,
        type: 'chapter-title',
      })
    );
  }

  const sectionIds = getOrderedSectionIds(chapter);
  sectionIds.forEach((sectionId) => {
    const section = chapter.sections?.[sectionId];
    if (!section) {
      return;
    }
    if (section.title) {
      parts.push(
        createChunkPart(section.title, false, 'chapter', {
          chapterId,
          sectionId,
          type: 'section-title',
        })
      );
    }
    const pointIds = getOrderedPointIds(section);
    pointIds.forEach((pointId) => {
      const point = section.points?.[pointId];
      if (!point) {
        return;
      }
      if (point.title) {
        parts.push(
          createChunkPart(point.title, false, 'chapter', {
            chapterId,
            sectionId,
            pointId,
            type: 'point-title',
          })
        );
      }
      const paragraphs = Array.isArray(point.text) ? point.text : [];
      paragraphs.forEach((paragraph, paragraphIndex) => {
        const textValue = typeof paragraph === 'string' ? paragraph : String(paragraph ?? '');
        parts.push(
          createChunkPart(textValue, false, null, {
            chapterId,
            sectionId,
            pointId,
            paragraphIndex,
            type: 'paragraph',
          })
        );
      });
    });
  });
  return parts;
}

function renderReader({ forceReflow = false } = {}) {
  ensureSelection();
  const { chapterId, sectionId, pointId } = state;
  console.info('[Reader] render start: chapter=%s section=%s point=%s page=%d', chapterId ?? 'n/a', sectionId ?? 'n/a', pointId ?? 'n/a', state.pageIndex + 1);

  const chapter = BOOKS[chapterId];
  if (!chapter) {
    const fallbackChunk = [
      createChunkPart('Content unavailable', false, 'title'),
      createChunkPart('Unable to resolve the requested chapter or section.'),
    ];
    renderFallbackContent(fallbackChunk);
    state.flowParts = [];
    state.flowChapterId = null;
    return;
  }

  const flowParts = ensureFlowParts(chapterId);
  if (!flowParts.length) {
    const fallbackChunk = [
      createChunkPart(chapter.title || 'Content unavailable', false, 'title'),
      createChunkPart('No readable content found for this chapter.'),
    ];
    renderFallbackContent(fallbackChunk);
    return;
  }

  const metrics = getPaginationMetrics();
  if (!metrics || metrics.columnWidth <= 0 || metrics.columnHeight <= 0) {
    console.warn('[Reader] layout metrics unavailable, skipping render');
    return;
  }

  const paginationKey = createPaginationKey(chapterId, metrics);
  let layoutRebuilt = forceReflow || !state.pagination || state.paginationKey !== paginationKey;
  if (layoutRebuilt) {
    const pagination = buildPagination(flowParts, metrics);
    if (!pagination || !Number.isFinite(pagination.totalPages) || pagination.totalPages <= 0) {
      const fallbackChunk = [
        createChunkPart('Layout error', false, 'title'),
        createChunkPart('Unable to prepare pagination for this content.'),
      ];
      renderFallbackContent(fallbackChunk);
      return;
    }
    state.pagination = pagination;
    state.paginationKey = paginationKey;
    console.info('[Reader] layout rebuilt: pages=%d gap=%d width=%d', pagination.totalPages, Math.round(pagination.columnGap), Math.round(pagination.columnWidth));
  }

  const pagination = state.pagination;
  const totalPages = Number.isFinite(pagination?.totalPages) ? pagination.totalPages : 0;
  if (!totalPages) {
    const fallbackChunk = [
      createChunkPart('Layout error', false, 'title'),
      createChunkPart('Pagination produced no pages.'),
    ];
    renderFallbackContent(fallbackChunk);
    return;
  }

  if (state.autoAlignPage && pointId && pagination.anchorMap) {
    const anchorIndex = pagination.anchorMap[pointId];
    if (Number.isInteger(anchorIndex)) {
      state.pageIndex = clampValue(anchorIndex, 0, totalPages - 1);
    }
  }
  state.autoAlignPage = false;
  state.pageIndex = clampValue(state.pageIndex, 0, totalPages - 1);

  applyLayout(pagination, metrics, { immediate: layoutRebuilt });
  applyPageTransform(pagination, state.pageIndex, { immediate: layoutRebuilt });
  updateLayoutInfo(pagination, metrics);

  const anchor = resolvePageAnchor(pagination, state.pageIndex);
  if (anchor) {
    if (anchor.sectionId && anchor.sectionId !== sectionId) {
      state.sectionId = anchor.sectionId;
    }
    if (anchor.pointId && anchor.pointId !== pointId) {
      state.pointId = anchor.pointId;
    }
  }

  const progressValue = totalPages ? ((state.pageIndex + 1) / totalPages) * 100 : 0;
  readerProgress.style.width = `${progressValue}%`;

  if (state.autoVoice) {
    const speechText = getVisiblePageText();
    if (speechText) {
      speak(speechText);
    }
  }

  persistProgress();

  console.info('[Reader] render complete: page=%d/%d', state.pageIndex + 1, totalPages);
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
      renderFallbackContent(fallbackChunk);
      state.flowParts = [];
      state.flowChapterId = null;
      state.pageIndex = 0;
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
      chunkIndex: state.pageIndex,
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


