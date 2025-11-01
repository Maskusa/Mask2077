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
const MIN_TURN_SPEED = 0.1;
const MAX_TURN_SPEED = 2;
const DEFAULT_TURN_SPEED = 0.57;
const COLUMN_GAP_MULTIPLIER = 10;
const COLUMN_GAP_MIN = 240;
const COLUMN_GAP_MAX = 720;
const A4_RATIO = 1.4142;

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

function scheduleReaderRender({ forceReflow = false } = {}) {
  if (forceReflow) {
    pendingRenderOptions.forceReflow = true;
  }
  if (renderScheduled) {
    return;
  }
  renderScheduled = true;
  const runner = window.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
  runner(() => {
    renderScheduled = false;
    const options = pendingRenderOptions;
    pendingRenderOptions = { forceReflow: false };
    renderReader(options);
  });
}

let BOOKS = {};
let chapterOrder = [];
let renderScheduled = false;
let pendingRenderOptions = { forceReflow: false };

const readerRoot = document.querySelector('.reader');
if (!readerRoot) {
  console.warn('[Reader] root element not found');
  throw new Error('Reader root not found');
}

console.info('[Reader] Страница чтения активирована');

const readerApp = document.querySelector('.app--reader');
const readerViewport = document.getElementById('reader-viewport');
const readerPageShell = document.getElementById('reader-page');
const readerPlane = document.getElementById('reader-plane');
const readerFrame = document.getElementById('reader-frame');
const readerPageBuffer = document.getElementById('reader-page-buffer');
const readerBackgroundBuffer = document.getElementById('reader-background-buffer');
const readerBackgroundActive = document.getElementById('reader-background-active');
const readerFlow = document.getElementById('reader-flow');
const readerFlowBuffer = document.getElementById('reader-flow-buffer');
const layoutInfo = document.getElementById('reader-layout-info');
const readerProgress = document.getElementById('reader-progress');
const readerControls = Array.from(readerRoot.querySelectorAll('.reader__controls'));
const stylePopup = document.getElementById('style-popup');
const fontList = document.getElementById('font-list');
const fontOverlay = document.getElementById('font-overlay');
const fontTrigger = document.getElementById('font-trigger');
const currentFontLabel = document.getElementById('current-font-label');
const fontSizeLabel = document.getElementById('font-size-label');
const lineHeightLabel = document.getElementById('line-height-label');
const turnSpeedInput = document.getElementById('turn-speed');
const turnSpeedLabel = document.getElementById('turn-speed-label');
const readerStage = document.querySelector('.reader__stage');
let controlsHidden = false;

const DEFAULT_COLUMN_GAP = 32;
const PAGE_TRANSITION_BASE_DURATION = 450;
const PAGE_REVEAL_PRE_SCALE = 0.95;
const PAGE_REVEAL_DURATION = 200;
const PAGE_REVEAL_DELAY = 200;
const PAGE_FRAME_INSET = 12;
const OVERFLOW_HEIGHT_TOLERANCE = 4;
const ENABLE_PAGE_BACKGROUNDS = false;
const PAGE_BACKGROUND_IMAGES = ['images/page_v1.svg', 'images/page_v2.svg'];
const flowLogState = {
  lastVersion: new Map(),
};
let lastWidthMismatchKey = null;
const widthMismatchReflowAttempts = new Map();

if (!readerViewport || !readerPageShell || !readerPlane || !readerFlow) {
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


function updateReaderAppLayout() {
  if (!readerApp) {
    return null;
  }
  const viewportHeight =
    window.innerHeight ||
    document.documentElement?.clientHeight ||
    readerApp.clientHeight ||
    0;
  const viewportWidth =
    window.innerWidth ||
    document.documentElement?.clientWidth ||
    readerApp.clientWidth ||
    0;
  if (viewportHeight <= 0 || viewportWidth <= 0) {
    return {
      viewportWidth,
      viewportHeight,
      appMaxWidth: 0,
      pageMaxWidth: 0,
    };
  }
  const maxByHeight = viewportHeight / A4_RATIO;
  const appMaxWidth = Math.min(viewportWidth, maxByHeight);
  readerApp.style.maxWidth = `${appMaxWidth}px`;
  readerApp.style.width = '100%';
  let pageMaxWidth = appMaxWidth;
  if (readerRoot) {
    if (readerStage) {
      const stageStyle = window.getComputedStyle(readerStage);
      const stagePadding =
        (Number.parseFloat(stageStyle.paddingLeft) || 0) +
        (Number.parseFloat(stageStyle.paddingRight) || 0);
      pageMaxWidth = Math.max(0, appMaxWidth - stagePadding);
    }
    readerRoot.style.setProperty('--reader-page-max-width', `${Math.round(pageMaxWidth)}px`);
  }
  return {
    viewportWidth,
    viewportHeight,
    appMaxWidth,
    pageMaxWidth,
  };
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
const persistedTurnSpeed = Number(persistedPreferences?.turnSpeed);
const initialTurnSpeed = Number.isFinite(persistedTurnSpeed)
  ? clampValue(persistedTurnSpeed, MIN_TURN_SPEED, MAX_TURN_SPEED)
  : DEFAULT_TURN_SPEED;
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
  turnSpeed: initialTurnSpeed,
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
let planeBaseOffset = 0;
let cancelPlaneTransition = null;
let bufferRevealTimer = null;

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

function updateTurnSpeedControls() {
  const rawSpeed = Number(state.turnSpeed);
  const normalized = Number.isFinite(rawSpeed) ? clampValue(rawSpeed, MIN_TURN_SPEED, MAX_TURN_SPEED) : DEFAULT_TURN_SPEED;
  state.turnSpeed = Number(normalized.toFixed(2));
  if (turnSpeedInput) {
    turnSpeedInput.value = state.turnSpeed.toFixed(1);
  }
  if (turnSpeedLabel) {
    const display = Math.abs(state.turnSpeed - Math.round(state.turnSpeed)) < 0.05
      ? Math.round(state.turnSpeed).toString()
      : state.turnSpeed.toFixed(1);
    turnSpeedLabel.textContent = `${display}×`;
  }
}

function applyStyle({ skipRender = false } = {}) {
  const resolvedFont =
    resolveFontOption(state.style.font?.id) ??
    state.style.font ??
    resolveFontOption(DEFAULT_STYLE.fontId) ??
    FONT_OPTIONS[0];
  const fontSize = clampValue(Number(state.style.fontSize) || DEFAULT_STYLE.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const lineHeight = clampValue(Number(state.style.lineHeight) || DEFAULT_STYLE.lineHeight, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT);
  const fontWeight = normalizeFontWeight(state.style.fontWeight);
  const themeId = THEME_PRESETS[state.style.theme] ? state.style.theme : DEFAULT_STYLE.theme;
  const theme = THEME_PRESETS[themeId] ?? THEME_PRESETS[DEFAULT_STYLE.theme];

  state.style.font = resolvedFont;
  state.style.fontSize = fontSize;
  state.style.lineHeight = lineHeight;
  state.style.fontWeight = fontWeight;
  state.style.theme = themeId;

  readerRoot.style.setProperty('--reader-font-family', resolvedFont.css);
  readerRoot.style.setProperty('--reader-font-size', `${fontSize}px`);
  readerRoot.style.setProperty('--reader-line-height', lineHeight.toString());
  readerRoot.style.setProperty('--reader-font-weight', `${fontWeight}`);
  readerRoot.style.setProperty('--reader-text-color', theme.text);
  readerRoot.style.setProperty('--reader-backdrop', theme.backdrop);
  readerRoot.style.setProperty('--reader-page-surface', theme.surface);
  readerRoot.style.setProperty('--reader-page-border', theme.border);

  if (fontSizeLabel) {
    fontSizeLabel.textContent = String(Math.round(fontSize));
  }
  if (lineHeightLabel) {
    lineHeightLabel.textContent = `${Math.round(lineHeight * 100)}%`;
  }
  if (fontWeightInput) {
    fontWeightInput.value = String(fontWeight);
  }
  if (themeSelect) {
    themeSelect.value = themeId;
  }

  updateFontTriggerState();
  updateTurnSpeedControls();

  if (!skipRender) {
    clearPaginationState();
    scheduleReaderRender();
  }
  persistPreferences();
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
    const pagination = state.pagination;
    const columnHeight = Number.isFinite(pagination?.columnHeight) ? pagination.columnHeight : 0;
    const columnWidth = Number.isFinite(pagination?.columnWidth) ? pagination.columnWidth : 0;
    const scrollWidth = Number.isFinite(pagination?.scrollWidth) ? pagination.scrollWidth : 0;
    const scrollHeight = readerFlow?.scrollHeight ?? 0;
    const flowWidth = readerFlow?.scrollWidth ?? 0;
    const overflowHeight = Math.round(scrollHeight - columnHeight);
    const overflowWidth = Math.round(flowWidth - scrollWidth);
    console.info(
      '[Reader] page change skipped: boundary reached (index=%d of %d) overflowHeight=%d overflowWidth=%d column=%dx%d flow=%dx%d',
      currentIndex + 1,
      total,
      overflowHeight,
      overflowWidth,
      Math.round(columnWidth),
      Math.round(columnHeight),
      Math.round(flowWidth),
      Math.round(scrollHeight)
    );
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

function refreshLayout() {
  console.info('[Reader] manual layout refresh triggered');
  if (bufferRevealTimer) {
    window.clearTimeout(bufferRevealTimer);
    bufferRevealTimer = null;
  }
  widthMismatchReflowAttempts.clear();
  lastWidthMismatchKey = null;
  state.autoAlignPage = true;
  clearPaginationState();
  const shellWidthBefore = readerPageShell?.clientWidth ?? 0;
  const schedule = () => {
    const layoutMetrics = updateReaderAppLayout();
    const shellWidthAfter = readerPageShell?.clientWidth ?? 0;
    const viewportWidth = layoutMetrics?.viewportWidth ?? 0;
    const viewportHeight = layoutMetrics?.viewportHeight ?? 0;
    const appWidth = layoutMetrics?.appMaxWidth ?? 0;
    const pageWidth = layoutMetrics?.pageMaxWidth ?? 0;
    console.info(
      '[Reader] manual refresh metrics: viewport=%dx%d appWidth=%d pageWidth=%d shellBefore=%d shellAfter=%d',
      Math.round(viewportWidth),
      Math.round(viewportHeight),
      Math.round(appWidth),
      Math.round(pageWidth),
      Math.round(shellWidthBefore),
      Math.round(shellWidthAfter)
    );
    const frameRect = readerFrame?.getBoundingClientRect?.();
    const flowRect = readerFlow?.getBoundingClientRect?.();
    if (frameRect && flowRect) {
      console.info(
        '[Reader] manual refresh rects: frameWidth=%d flowWidth=%d frameX=%d flowX=%d',
        Math.round(frameRect.width),
        Math.round(flowRect.width),
        Math.round(frameRect.left),
        Math.round(flowRect.left)
      );
    }
    scheduleReaderRender({ forceReflow: true });
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(schedule);
  } else {
    setTimeout(schedule, 0);
  }
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
    case 'refresh-layout':
      event?.preventDefault?.();
      refreshLayout();
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

turnSpeedInput?.addEventListener('input', () => {
  const value = Number(turnSpeedInput.value);
  const normalized = Number.isFinite(value) ? clampValue(value, MIN_TURN_SPEED, MAX_TURN_SPEED) : state.turnSpeed;
  state.turnSpeed = Number(normalized.toFixed(2));
  updateTurnSpeedControls();
  if (state.pagination) {
    applyPageTransform(state.pagination, state.pageIndex, { immediate: true });
  }
  persistPreferences();
});

const readerZones = readerRoot.querySelectorAll('.reader__zone');
readerZones.forEach((zone) => {
  zone.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const { action } = zone.dataset;
    console.info('[Reader] Жест пролистывания: zone=%s', action);
    if (!action) {
      return;
    }
    handleAction(action, event);
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
  planeBaseOffset = 0;
  if (cancelPlaneTransition) {
    cancelPlaneTransition();
    cancelPlaneTransition = null;
  }
  if (readerPlane) {
    readerPlane.style.transition = 'none';
    readerPlane.style.transform = 'translate3d(0, 0, 0)';
  }
  if (readerFlow) {
    readerFlow.style.transition = 'none';
    readerFlow.style.transform = 'translate3d(0, 0, 0)';
  }
  resetPageBackgrounds();
}

function getPaginationMetrics() {
  if (!readerPageShell || !readerPlane || !readerFlow) {
    return null;
  }
  const planeStyle = window.getComputedStyle(readerPlane);
  const paddingTop = Number.parseFloat(planeStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(planeStyle.paddingBottom) || 0;
  const paddingLeft = Number.parseFloat(planeStyle.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(planeStyle.paddingRight) || 0;
  const planeClientWidth = readerPlane.clientWidth || readerPageShell.clientWidth;
  const planeClientHeight = readerPlane.clientHeight || readerPageShell.clientHeight;
  const frameHorizontalInset = PAGE_FRAME_INSET * 2;
  const frameVerticalInset = PAGE_FRAME_INSET * 2;
  const innerWidth = Math.max(0, planeClientWidth - paddingLeft - paddingRight - frameHorizontalInset);
  const innerHeight = Math.max(0, planeClientHeight - paddingTop - paddingBottom - frameVerticalInset);
  const flowStyle = readerFlow ? window.getComputedStyle(readerFlow) : null;
  const flowPaddingTop = flowStyle ? Number.parseFloat(flowStyle.paddingTop) || 0 : 0;
  const flowPaddingBottom = flowStyle ? Number.parseFloat(flowStyle.paddingBottom) || 0 : 0;
  const flowPaddingLeft = flowStyle ? Number.parseFloat(flowStyle.paddingLeft) || 0 : 0;
  const flowPaddingRight = flowStyle ? Number.parseFloat(flowStyle.paddingRight) || 0 : 0;
  const effectiveWidth = Math.max(0, innerWidth - flowPaddingLeft - flowPaddingRight);
  const effectiveHeight = Math.max(0, innerHeight - flowPaddingTop - flowPaddingBottom);
  const fontScale = Math.max(0.35, state.style.fontSize / DEFAULT_STYLE.fontSize);
  const baseGap = Math.max(0, Math.round(DEFAULT_COLUMN_GAP * Math.sqrt(fontScale)));
  const columnGap = clampValue(baseGap * COLUMN_GAP_MULTIPLIER, COLUMN_GAP_MIN, COLUMN_GAP_MAX);
  const columnWidth = Math.max(1, effectiveWidth);
  const columnHeight = Math.max(1, effectiveHeight);
  return {
    measurementHost: readerPlane,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    innerWidth,
    innerHeight,
    columnWidth,
    columnHeight,
    columnGap,
    flowPaddingTop,
    flowPaddingBottom,
    flowPaddingLeft,
    flowPaddingRight,
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
  measurement.style.paddingTop = '0';
  measurement.style.paddingBottom = '0';
  measurement.style.paddingLeft = `${metrics.flowPaddingLeft}px`;
  measurement.style.paddingRight = `${metrics.flowPaddingRight}px`;
  measurement.style.margin = '0';
  measurement.style.transform = 'none';
  measurement.style.transition = 'none';
  metrics.measurementHost.appendChild(measurement);

  const fragment = document.createDocumentFragment();
  flowParts.forEach((part) => {
    fragment.appendChild(createContentElement(part));
  });
  measurement.appendChild(fragment);

  let scrollWidth = Math.max(measurement.scrollWidth, metrics.columnWidth);
  const pageShiftWidth = metrics.columnWidth + metrics.columnGap;
  const overflowHeight = Math.max(0, measurement.scrollHeight - metrics.columnHeight);
  if (overflowHeight > OVERFLOW_HEIGHT_TOLERANCE && pageShiftWidth > 0) {
    const extraColumns = Math.max(1, Math.ceil(overflowHeight / metrics.columnHeight));
    scrollWidth += extraColumns * pageShiftWidth;
    console.info(
      '[Reader] pagination overflow compensation: overflowHeight=%d extraColumns=%d',
      Math.round(overflowHeight),
      extraColumns
    );
  }
  const rawPageCount = pageShiftWidth > 0 ? (scrollWidth + metrics.columnGap) / pageShiftWidth : 1;
  const totalPages = Math.max(1, Math.ceil(rawPageCount));

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

function safeParagraphKeyPart(value) {
  return value === undefined || value === null ? '' : String(value);
}

function buildParagraphKeyFromMeta(meta) {
  if (!meta || meta.paragraphIndex === undefined || meta.paragraphIndex === null) {
    return null;
  }
  return [
    safeParagraphKeyPart(meta.chapterId),
    safeParagraphKeyPart(meta.sectionId),
    safeParagraphKeyPart(meta.pointId),
    safeParagraphKeyPart(meta.paragraphIndex),
  ].join('|');
}

function buildParagraphKeyFromDataset(dataset) {
  if (!dataset) {
    return null;
  }
  const paragraphIndex = dataset.paragraphIndex;
  if (paragraphIndex === undefined || paragraphIndex === null || paragraphIndex === '') {
    return null;
  }
  return [
    safeParagraphKeyPart(dataset.chapterId),
    safeParagraphKeyPart(dataset.sectionId),
    safeParagraphKeyPart(dataset.pointId),
    safeParagraphKeyPart(paragraphIndex),
  ].join('|');
}

function formatParagraphKey(key) {
  if (!key) {
    return '?';
  }
  const [chapterId = '', sectionId = '', pointId = '', paragraphIndex = ''] = key.split('|');
  const chapterLabel = chapterId || '?';
  const sectionLabel = sectionId || '?';
  const pointLabel = pointId || '?';
  const indexLabel = paragraphIndex || '?';
  return `${chapterLabel}>${sectionLabel}>${pointLabel}#${indexLabel}`;
}

// Debug helper that logs rendered block statistics for a given flow container.
function logSingleFlowState(targetFlow, label, pagination, expected) {
  if (!targetFlow) {
    return;
  }
  const version = pagination?.version ?? null;
  if (version && flowLogState.lastVersion.get(label) === version) {
    return;
  }
  if (version) {
    flowLogState.lastVersion.set(label, version);
  }
  const blockNodes = Array.from(targetFlow.children).filter((node) => node instanceof HTMLElement);
  const textLength = targetFlow.textContent ? targetFlow.textContent.length : 0;
  const paragraphNodes = Array.from(targetFlow.querySelectorAll('[data-paragraph-index]'));
  const actualKeys = new Set();
  const duplicateKeys = new Set();
  let incompleteParagraphs = 0;
  const lengthMismatches = [];
  const expectedParagraphs = expected?.paragraphs;
  paragraphNodes.forEach((node) => {
    const key = buildParagraphKeyFromDataset(node.dataset);
    if (!key) {
      incompleteParagraphs += 1;
      return;
    }
    if (actualKeys.has(key)) {
      duplicateKeys.add(key);
    } else {
      actualKeys.add(key);
    }
    const expectedInfo = expectedParagraphs?.get?.(key);
    if (expectedInfo) {
      const actualLength = (node.textContent ?? '').length;
      if (Math.abs(actualLength - expectedInfo.length) > 4) {
        lengthMismatches.push({
          key,
          expected: expectedInfo.length,
          actual: actualLength,
          preview: (node.textContent ?? '').trim().slice(0, 96).replace(/\s+/g, ' '),
          tagName: node.tagName,
        });
      }
    }
  });

  const missingKeys = [];
  expected.keys.forEach((key) => {
    if (!actualKeys.has(key)) {
      missingKeys.push(key);
    }
  });
  const extraKeys = [];
  actualKeys.forEach((key) => {
    if (!expected.keys.has(key)) {
      extraKeys.push(key);
    }
  });

  if (lengthMismatches.length) {
    lengthMismatches.slice(0, 5).forEach((entry) => {
      console.warn(
        '[Reader] css chunk paragraph length mismatch: target=%s element=%s id=%s expected=%d actual=%d sample=%s',
        label,
        entry.tagName ?? '?',
        formatParagraphKey(entry.key),
        entry.expected,
        entry.actual,
        entry.preview
      );
    });
  }

  const sampleNodes = paragraphNodes.slice(-3);
  const tailSample = sampleNodes
    .map((node) => {
      const key = buildParagraphKeyFromDataset(node.dataset);
      const id = key ? formatParagraphKey(key) : '?:?:?:?';
      const rawText = (node.textContent || '').trim().replace(/\s+/g, ' ');
      const preview = rawText.length > 48 ? `${rawText.slice(0, 45)}...` : rawText;
      return `${id}:${preview}`;
    })
    .join(' | ') || 'n/a';

  console.info(
    '[Reader] css chunks ready: target=%s version=%s blocks=%d paragraphs=%d/%d textChars=%d duplicates=%d missing=%d extra=%d incomplete=%d totalParts=%d',
    label,
    pagination?.version ?? '?',
    blockNodes.length,
    actualKeys.size,
    expected.paragraphCount,
    textLength,
    duplicateKeys.size,
    missingKeys.length,
    extraKeys.length,
    incompleteParagraphs,
    expected.totalParts
  );
  if (missingKeys.length) {
    const sample = missingKeys.slice(0, 5).map(formatParagraphKey).join(', ');
    console.warn('[Reader] css chunk missing paragraphs: target=%s count=%d sample=%s', label, missingKeys.length, sample);
  }
  if (duplicateKeys.size) {
    const sample = Array.from(duplicateKeys).slice(0, 5).map(formatParagraphKey).join(', ');
    console.warn('[Reader] css chunk duplicate paragraphs: target=%s count=%d sample=%s', label, duplicateKeys.size, sample);
  }
  if (extraKeys.length) {
    const sample = extraKeys.slice(0, 5).map(formatParagraphKey).join(', ');
    console.warn('[Reader] css chunk unexpected paragraphs: target=%s count=%d sample=%s', label, extraKeys.length, sample);
  }
  if (incompleteParagraphs) {
    console.warn('[Reader] css chunk paragraphs without metadata: target=%s count=%d', label, incompleteParagraphs);
  }
  console.info('[Reader] css chunk tail sample: target=%s %s', label, tailSample);
}

// Collects logging data after CSS column content has been updated.
function logFlowContentState(pagination) {
  if (!pagination) {
    return;
  }
  const flowParts = Array.isArray(state.flowParts) ? state.flowParts : [];
  const expectedKeys = new Set();
  const expectedParagraphs = new Map();
  flowParts.forEach((part) => {
    if (!part || part.meta?.type !== 'paragraph') {
      return;
    }
    const key = buildParagraphKeyFromMeta(part.meta);
    if (key) {
      expectedKeys.add(key);
      expectedParagraphs.set(key, {
        length: typeof part.text === 'string' ? part.text.length : 0,
      });
    }
  });
  const expected = {
    keys: expectedKeys,
    paragraphCount: expectedKeys.size,
    totalParts: flowParts.length,
    paragraphs: expectedParagraphs,
  };
  logSingleFlowState(readerFlow, 'flow', pagination, expected);
  logSingleFlowState(readerFlowBuffer, 'buffer-flow', pagination, expected);
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

let activeBackgroundPageIndex = null;
let bufferBackgroundPageIndex = null;

function resolveBackgroundAsset(pageIndex) {
  if (!PAGE_BACKGROUND_IMAGES.length) {
    return null;
  }
  if (!Number.isFinite(pageIndex)) {
    return null;
  }
  const totalAssets = PAGE_BACKGROUND_IMAGES.length;
  const normalized = ((Math.trunc(pageIndex) % totalAssets) + totalAssets) % totalAssets;
  return PAGE_BACKGROUND_IMAGES[normalized] ?? null;
}

function applyBackground(element, pageIndex) {
  if (!element) {
    return null;
  }
  if (!ENABLE_PAGE_BACKGROUNDS) {
    element.style.backgroundImage = 'none';
    element.dataset.pageBackground = '';
    return null;
  }
  if (!Number.isFinite(pageIndex)) {
    element.style.backgroundImage = 'none';
    element.dataset.pageBackground = '';
    return null;
  }
  const normalizedIndex = Math.trunc(pageIndex);
  if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0) {
    element.style.backgroundImage = 'none';
    element.dataset.pageBackground = '';
    return null;
  }
  const asset = resolveBackgroundAsset(normalizedIndex);
  if (!asset) {
    element.style.backgroundImage = 'none';
    element.dataset.pageBackground = '';
    return null;
  }
  element.style.backgroundImage = `url('${asset}')`;
  element.dataset.pageBackground = String(normalizedIndex);
  return normalizedIndex;
}

function setActivePageBackground(pageIndex) {
  if (activeBackgroundPageIndex === pageIndex) {
    return;
  }
  activeBackgroundPageIndex = applyBackground(readerBackgroundActive, pageIndex);
}

function setBufferPageBackground(pageIndex) {
  if (bufferBackgroundPageIndex === pageIndex) {
    return;
  }
  bufferBackgroundPageIndex = applyBackground(readerBackgroundBuffer, pageIndex);
}

function resetPageBackgrounds() {
  activeBackgroundPageIndex = null;
  bufferBackgroundPageIndex = null;
  if (readerBackgroundActive) {
    readerBackgroundActive.style.backgroundImage = 'none';
    readerBackgroundActive.dataset.pageBackground = '';
  }
  if (readerBackgroundBuffer) {
    readerBackgroundBuffer.style.backgroundImage = 'none';
    readerBackgroundBuffer.dataset.pageBackground = '';
  }
  resetBufferFlow();
}

function resetBufferFlow() {
  if (readerFlowBuffer) {
    readerFlowBuffer.innerHTML = '';
    readerFlowBuffer.style.transition = 'none';
    readerFlowBuffer.style.transform = 'translate3d(0, 0, 0)';
    readerFlowBuffer.style.width = '';
    readerFlowBuffer.style.height = '';
    readerFlowBuffer.style.columnWidth = '';
    readerFlowBuffer.style.columnGap = '';
    readerFlowBuffer.dataset.pageIndex = '0';
    readerFlowBuffer.dataset.contentVersion = '';
  }
  if (readerPageBuffer) {
    readerPageBuffer.style.transition = 'none';
    readerPageBuffer.style.transform = 'translate3d(0, 0, 0) scale(1)';
    readerPageBuffer.dataset.pageIndex = '0';
    readerPageBuffer.dataset.revealPage = '';
  }
  if (bufferRevealTimer) {
    window.clearTimeout(bufferRevealTimer);
    bufferRevealTimer = null;
  }
}

function ensureBufferContent(pagination) {
  if (!readerFlowBuffer) {
    return;
  }
  if (readerFlowBuffer.dataset.contentVersion === pagination.version) {
    return;
  }
  readerFlowBuffer.innerHTML = pagination.contentHTML;
  readerFlowBuffer.dataset.contentVersion = pagination.version;
}

function applyFlowDimensions(targetFlow, pagination, flowWidth) {
  if (!targetFlow) {
    return;
  }
  targetFlow.style.columnGap = `${pagination.columnGap}px`;
  targetFlow.style.columnWidth = `${pagination.columnWidth}px`;
  targetFlow.style.height = `${pagination.columnHeight}px`;
  targetFlow.style.width = `${flowWidth}px`;
}

function alignFlowToPage(targetFlow, pagination, pageIndex) {
  if (!targetFlow) {
    return 0;
  }
  const totalPages = Number.isFinite(pagination.totalPages) ? pagination.totalPages : 0;
  const safeIndex = clampValue(pageIndex, 0, Math.max(0, totalPages - 1));
  const targetOffset = Math.max(0, safeIndex) * pagination.pageShiftWidth;
  targetFlow.style.transition = 'none';
  targetFlow.style.transform = `translate3d(-${targetOffset}px, 0, 0)`;
  targetFlow.dataset.pageIndex = String(safeIndex);
  if (targetFlow === readerFlowBuffer && readerPageBuffer) {
    readerPageBuffer.dataset.pageIndex = String(safeIndex);
  }
  const targetName = targetFlow === readerFlow ? 'flow' : targetFlow === readerFlowBuffer ? 'buffer-flow' : 'unknown-flow';
  console.info('[Reader] alignFlowToPage: target=%s page=%d offset=%d', targetName, safeIndex, Math.round(targetOffset));
  return targetOffset;
}

function setBufferRevealScale(scale, { duration = 0 } = {}) {
  if (!readerPageBuffer) {
    return;
  }
  if (duration > 0) {
    readerPageBuffer.style.transition = `transform ${duration}ms ease-out`;
  } else {
    readerPageBuffer.style.transition = 'none';
  }
  readerPageBuffer.style.transform = `translate3d(0, 0, 0) scale(${scale})`;
  console.info('[Reader] setBufferRevealScale: page=%s scale=%s duration=%d', readerPageBuffer.dataset.revealPage ?? '?', scale.toFixed(2), duration);
}

function prepareBufferForPage(pageIndex, { preScale = 1 } = {}) {
  if (!readerPageBuffer) {
    return;
  }
  if (bufferRevealTimer) {
    window.clearTimeout(bufferRevealTimer);
    bufferRevealTimer = null;
    console.info('[Reader] buffer reveal timer cleared before prepare');
  }
  readerPageBuffer.dataset.revealPage = Number.isFinite(pageIndex) ? String(pageIndex) : '';
  setBufferRevealScale(preScale, { duration: 0 });
  if (Number.isFinite(pageIndex)) {
    console.info('[Reader] buffer prepared: page=%d scale=%s', pageIndex, preScale.toFixed(2));
  }
}

function scheduleBufferReveal(pageIndex, delayMs) {
  if (!readerPageBuffer) {
    return;
  }
  if (bufferRevealTimer) {
    window.clearTimeout(bufferRevealTimer);
    bufferRevealTimer = null;
    console.info('[Reader] buffer reveal timer cleared before reschedule');
  }
  const revealDelay = Math.max(0, delayMs);
  console.info('[Reader] buffer reveal scheduled: page=%d delay=%dms', pageIndex, revealDelay);
  bufferRevealTimer = window.setTimeout(() => {
    setBufferRevealScale(1, { duration: PAGE_REVEAL_DURATION });
    console.info('[Reader] buffer reveal start: page=%d delay=%dms', pageIndex, revealDelay);
    bufferRevealTimer = null;
  }, revealDelay);
}

function getPageTransitionDuration() {
  const speed = Number.isFinite(Number(state.turnSpeed))
    ? clampValue(Number(state.turnSpeed), MIN_TURN_SPEED, MAX_TURN_SPEED)
    : DEFAULT_TURN_SPEED;
  const duration = Math.round(PAGE_TRANSITION_BASE_DURATION / speed);
  return Math.max(0, duration);
}

function applyLayout(pagination, metrics, { immediate = false } = {}) {
  if (!readerFlow || !readerPlane) {
    return;
  }
  ensureFlowContent(pagination);
  ensureBufferContent(pagination);
  logFlowContentState(pagination);
  const themeId = state.style.theme ?? '';
  const isDarkTheme = /night|console/.test(themeId);
  const ruleColor = isDarkTheme ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.08)';
  readerRoot.style.setProperty('--reader-column-gap', `${pagination.columnGap}px`);
  readerRoot.style.setProperty('--reader-column-width', `${pagination.columnWidth}px`);
  readerRoot.style.setProperty('--reader-column-rule', ruleColor);
  const flowViewportWidth = Math.max(pagination.columnWidth, metrics.innerWidth, 1);
  applyFlowDimensions(readerFlow, pagination, flowViewportWidth);
  applyFlowDimensions(readerFlowBuffer, pagination, flowViewportWidth);
  const currentFlowWidth = readerFlow?.scrollWidth ?? 0;
  if (Number.isFinite(currentFlowWidth)) {
    const normalizedWidth = Math.max(currentFlowWidth, pagination.scrollWidth || 0);
    const widthDiff = Math.abs(normalizedWidth - (pagination.scrollWidth || 0));
    const mismatchThreshold = Math.max(pagination.columnWidth * 0.25, 48);
    const pageShift = pagination.pageShiftWidth || (pagination.columnWidth + pagination.columnGap);
    const domTotalPages =
      pageShift > 0 ? Math.max(1, Math.ceil((normalizedWidth + pagination.columnGap) / pageShift)) : pagination.totalPages;
    if (domTotalPages > pagination.totalPages) {
      const previousPages = pagination.totalPages;
      pagination.totalPages = domTotalPages;
      pagination.scrollWidth = normalizedWidth;
      while (pagination.pageAnchors.length < pagination.totalPages) {
        pagination.pageAnchors.push(null);
      }
      console.info(
        '[Reader] pagination extended by DOM measurement: pages=%d->%d width=%d',
        previousPages,
        pagination.totalPages,
        Math.round(normalizedWidth)
      );
      widthMismatchReflowAttempts.clear();
      lastWidthMismatchKey = null;
    } else {
      if (widthDiff > mismatchThreshold) {
        const attemptKey = state.paginationKey ?? pagination.version ?? 'unknown';
        const columnCount =
          Number.isFinite(pagination.pageShiftWidth) && pagination.pageShiftWidth > 0
            ? Math.round(pagination.scrollWidth / pagination.pageShiftWidth)
            : -1;
        const attempts = widthMismatchReflowAttempts.get(attemptKey) ?? 0;
        if (attempts === 0) {
          widthMismatchReflowAttempts.set(attemptKey, attempts + 1);
          console.warn(
            '[Reader] layout width mismatch detected: expected=%d actual=%d diff=%d columns=%d gap=%d width=%d -> scheduling reflow',
            Math.round(pagination.scrollWidth),
            Math.round(currentFlowWidth),
            Math.round(widthDiff),
            columnCount,
            Math.round(pagination.columnGap),
            Math.round(pagination.columnWidth)
          );
          state.pagination = null;
          state.paginationKey = null;
          scheduleReaderRender();
          return;
        }
        if (lastWidthMismatchKey !== attemptKey) {
          console.warn(
            '[Reader] layout width mismatch persists after retry: expected=%d actual=%d diff=%d columns=%d gap=%d width=%d',
            Math.round(pagination.scrollWidth),
            Math.round(currentFlowWidth),
            Math.round(widthDiff),
            columnCount,
            Math.round(pagination.columnGap),
            Math.round(pagination.columnWidth)
          );
          lastWidthMismatchKey = attemptKey;
        }
      } else {
        const attemptKey = state.paginationKey ?? pagination.version ?? 'unknown';
        widthMismatchReflowAttempts.delete(attemptKey);
        if (lastWidthMismatchKey === attemptKey) {
          lastWidthMismatchKey = null;
        }
      }
    }
  }

  const totalPages = Number.isFinite(pagination.totalPages) ? pagination.totalPages : 0;
  const safeIndex = clampValue(state.pageIndex, 0, Math.max(0, totalPages - 1));
  const maxOffset = Math.max(0, (totalPages - 1) * pagination.pageShiftWidth);
  planeBaseOffset = clampValue(planeBaseOffset, 0, maxOffset);
  if (immediate) {
    planeBaseOffset = safeIndex * pagination.pageShiftWidth;
    console.info('[Reader] applyLayout immediate: page=%d offset=%d', safeIndex, Math.round(planeBaseOffset));
  }

  readerFlow.style.transition = 'none';
  readerFlow.style.transform = `translate3d(-${planeBaseOffset}px, 0, 0)`;
  readerPlane.style.transition = 'none';
  readerPlane.style.transform = 'translate3d(0, 0, 0) scale(1)';
  const renderedIndexRaw = Number.parseInt(readerFlow.dataset.pageIndex ?? '', 10);
  const renderedIndexBase = Number.isFinite(renderedIndexRaw) ? renderedIndexRaw : safeIndex;
  const renderedIndex = clampValue(renderedIndexBase, 0, Math.max(0, totalPages - 1));
  if (immediate) {
    readerFlow.dataset.pageIndex = String(safeIndex);
    readerPlane.dataset.pageIndex = String(safeIndex);
  }
  const bufferIndex = immediate ? safeIndex : renderedIndex;
  alignFlowToPage(readerFlowBuffer, pagination, bufferIndex);
  prepareBufferForPage(bufferIndex, { preScale: 1 });
  setActivePageBackground(bufferIndex);
  setBufferPageBackground(bufferIndex);
  const frameBounds = readerFrame?.getBoundingClientRect?.();
  const flowBounds = readerFlow?.getBoundingClientRect?.();
  if (frameBounds && flowBounds) {
    console.info(
      '[Reader] layout bounds: frameWidth=%d flowWidth=%d frameX=%d flowX=%d',
      Math.round(frameBounds.width),
      Math.round(flowBounds.width),
      Math.round(frameBounds.left),
      Math.round(flowBounds.left)
    );
  }
  const flowScrollHeight = readerFlow?.scrollHeight ?? 0;
  if (Number.isFinite(flowScrollHeight) && pagination.columnHeight) {
    const overflow = flowScrollHeight - pagination.columnHeight;
    console.info(
      '[Reader] layout height check: column=%d scroll=%d overflow=%d',
      Math.round(pagination.columnHeight),
      Math.round(flowScrollHeight),
      Math.round(overflow)
    );
  }
}

function applyPageTransform(pagination, pageIndex, { immediate = false } = {}) {
  if (!readerFlow || !readerPlane) {
    return;
  }
  const totalPages = Number.isFinite(pagination.totalPages) ? pagination.totalPages : 0;
  const safeIndex = clampValue(pageIndex, 0, Math.max(0, totalPages - 1));
  const targetOffset = Math.max(0, safeIndex) * pagination.pageShiftWidth;
  const delta = targetOffset - planeBaseOffset;
  const currentIndex = Number.parseInt(readerFlow.dataset.pageIndex ?? '0', 10) || 0;
  const shouldReveal = !immediate && Math.abs(delta) >= 0.5;
  console.info(
    '[Reader] page turn start: from=%d to=%d delta=%d immediate=%s reveal=%s',
    currentIndex,
    safeIndex,
    Math.round(delta),
    immediate ? 'true' : 'false',
    shouldReveal ? 'yes' : 'no'
  );

  if (cancelPlaneTransition) {
    console.info('[Reader] cancelPlaneTransition invoked before new turn');
    cancelPlaneTransition();
    cancelPlaneTransition = null;
  }

  alignFlowToPage(readerFlowBuffer, pagination, safeIndex);
  setBufferPageBackground(safeIndex);
  console.info('[Reader] buffer prepared for page %d', safeIndex);
  const bufferPreScale = shouldReveal ? PAGE_REVEAL_PRE_SCALE : 1;
  console.info(
    '[Reader] buffer pre-scale decision: page=%d scale=%s reveal=%s',
    safeIndex,
    bufferPreScale.toFixed(2),
    shouldReveal ? 'yes' : 'no'
  );
  prepareBufferForPage(safeIndex, { preScale: bufferPreScale });
  if (shouldReveal) {
    scheduleBufferReveal(safeIndex, PAGE_REVEAL_DELAY);
  }

  const duration = getPageTransitionDuration();
  const shouldJump = immediate || Math.abs(delta) < 0.5 || !Number.isFinite(delta) || duration <= 0;
  if (shouldJump) {
    planeBaseOffset = targetOffset;
    readerFlow.style.transition = 'none';
    readerFlow.style.transform = `translate3d(-${planeBaseOffset}px, 0, 0)`;
    readerPlane.style.transition = 'none';
    readerPlane.style.transform = 'translate3d(0, 0, 0) scale(1)';
    readerFlow.dataset.pageIndex = String(safeIndex);
    readerPlane.dataset.pageIndex = String(safeIndex);
    setActivePageBackground(safeIndex);
    setBufferPageBackground(safeIndex);
    alignFlowToPage(readerFlowBuffer, pagination, safeIndex);
    prepareBufferForPage(safeIndex, { preScale: 1 });
    console.info(
      '[Reader] page turn applied instantly to page %d (reveal=%s)',
      safeIndex,
      shouldReveal ? 'yes' : 'no'
    );
    cancelPlaneTransition = null;
    return;
  }

  readerFlow.style.transition = 'none';
  readerPlane.style.transition = 'none';
  readerPlane.style.transform = 'translate3d(0, 0, 0) scale(1)';
  void readerPlane.offsetWidth;

  const finalize = (reason = 'complete') => {
    planeBaseOffset = targetOffset;
    readerFlow.style.transition = 'none';
    readerFlow.style.transform = `translate3d(-${planeBaseOffset}px, 0, 0)`;
    readerPlane.style.transition = 'none';
    readerPlane.style.transform = 'translate3d(0, 0, 0) scale(1)';
    readerFlow.dataset.pageIndex = String(safeIndex);
    readerPlane.dataset.pageIndex = String(safeIndex);
    setActivePageBackground(safeIndex);
    setBufferPageBackground(safeIndex);
    alignFlowToPage(readerFlowBuffer, pagination, safeIndex);
    if (reason === 'complete') {
      prepareBufferForPage(safeIndex, { preScale: 1 });
    } else {
      console.info('[Reader] finalize skip reveal due to reason=%s', reason);
    }
    console.info(
      '[Reader] page turn finalize: now at page %d (reveal=%s reason=%s)',
      safeIndex,
      shouldReveal ? 'yes' : 'no',
      reason
    );
  };

  const onTransitionEnd = (event) => {
    if (event.target !== readerPlane || event.propertyName !== 'transform') {
      return;
    }
    readerPlane.removeEventListener('transitionend', onTransitionEnd);
    console.info('[Reader] plane transition end event captured');
    finalize('complete');
    cancelPlaneTransition = null;
  };

  cancelPlaneTransition = () => {
    readerPlane.removeEventListener('transitionend', onTransitionEnd);
    console.info('[Reader] cancelPlaneTransition executed (during turn)');
    finalize('cancel');
    cancelPlaneTransition = null;
  };

  readerPlane.addEventListener('transitionend', onTransitionEnd);
  readerPlane.style.transition = duration ? `transform ${duration}ms ease` : 'none';
  readerPlane.style.transform = `translate3d(${-delta}px, 0, 0) scale(1)`;
  readerPlane.dataset.pageIndex = String(safeIndex);
  console.info('[Reader] plane transition: offset=%d duration=%dms', Math.round(delta), duration);
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
  readerFlow.style.transform = 'translate3d(0, 0, 0)';
  readerFlow.dataset.pageIndex = '0';
  readerFlow.dataset.contentVersion = 'fallback';
  readerFlow.style.width = '';
  readerFlow.style.height = '';
  readerFlow.style.columnWidth = '';
  readerFlow.style.columnGap = '';
  if (readerPlane) {
    readerPlane.style.transition = 'none';
    readerPlane.style.transform = 'translate3d(0, 0, 0)';
    readerPlane.dataset.pageIndex = '0';
  }
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

  const diagnostics = {
    totalSections: 0,
    totalPoints: 0,
    totalParagraphs: 0,
    emptyPoints: [],
    shortParagraphSamples: [],
    totalTextLength: 0,
    longestParagraph: {
      key: null,
      textLength: 0,
    },
  };

  const updateLongestParagraph = (metaKey, paragraphText) => {
    const textLength = typeof paragraphText === 'string' ? paragraphText.length : 0;
    if (textLength > diagnostics.longestParagraph.textLength) {
      diagnostics.longestParagraph = {
        key: metaKey,
        textLength,
      };
    }
  };

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
    diagnostics.totalSections += 1;
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
      diagnostics.totalPoints += 1;
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
      if (!paragraphs.length) {
        diagnostics.emptyPoints.push({
          chapterId,
          sectionId,
          pointId,
          title: point.title ?? '',
          anchorId: point.anchorId ?? '',
        });
      }
      paragraphs.forEach((paragraph, paragraphIndex) => {
        const textValue = typeof paragraph === 'string' ? paragraph : String(paragraph ?? '');
        diagnostics.totalParagraphs += 1;
        diagnostics.totalTextLength += textValue.length;
        parts.push(
          createChunkPart(textValue, false, null, {
            chapterId,
            sectionId,
            pointId,
            paragraphIndex,
            type: 'paragraph',
          })
        );
        const metaKey = `${chapterId}>${sectionId}>${pointId}#${paragraphIndex}`;
        updateLongestParagraph(metaKey, textValue);
        if (textValue.length < 120) {
          diagnostics.shortParagraphSamples.push(`${metaKey}:${textValue.slice(0, 64).replace(/\s+/g, ' ')}${textValue.length > 64 ? '…' : ''}`);
        }
      });
    });
  });

  console.info(
    '[Reader] flow diagnostics: chapter=%s sections=%d points=%d paragraphs=%d parts=%d emptyPoints=%d totalChars=%d longest=%s(%d chars)',
    chapterId,
    diagnostics.totalSections,
    diagnostics.totalPoints,
    diagnostics.totalParagraphs,
    parts.length,
    diagnostics.emptyPoints.length,
    diagnostics.totalTextLength,
    diagnostics.longestParagraph.key ?? 'n/a',
    diagnostics.longestParagraph.textLength
  );
  if (diagnostics.emptyPoints.length) {
    const sample = diagnostics.emptyPoints.slice(0, 5).map((point) => {
      return `${point.chapterId}>${point.sectionId}>${point.pointId}(${point.title || '∅'})`;
    });
    console.warn(
      '[Reader] flow diagnostics empty points: chapter=%s count=%d sample=%s',
      chapterId,
      diagnostics.emptyPoints.length,
      sample.join(', ')
    );
  }
  if (diagnostics.shortParagraphSamples.length) {
    console.info(
      '[Reader] flow diagnostics short paragraphs: chapter=%s samples=%s',
      chapterId,
      diagnostics.shortParagraphSamples.slice(0, 5).join(' | ')
    );
  }

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
  console.info(
    '[Reader] layout metrics: inner=%dx%d column=%d gap=%d plane=%d shell=%d',
    Math.round(metrics.innerWidth),
    Math.round(metrics.innerHeight),
    Math.round(metrics.columnWidth),
    Math.round(metrics.columnGap),
    Math.round(readerPlane?.clientWidth ?? 0),
    Math.round(readerPageShell?.clientWidth ?? 0)
  );
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

updateReaderAppLayout();
renderFontList();
applyStyle({ skipRender: true });
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
      turnSpeed: state.turnSpeed,
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


const viewportChangeHandler = () => {
  updateReaderAppLayout();
  clearPaginationState();
  scheduleReaderRender();
};

window.addEventListener('resize', viewportChangeHandler, { passive: true });
window.addEventListener('orientationchange', viewportChangeHandler);

