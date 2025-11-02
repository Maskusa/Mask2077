import { loadBookData } from './book-data.js';
import {
  loadChapterUnlocks,
  persistChapterUnlocks,
  ensureChapterUnlocked,
  isChapterLocked,
  readStoredProgress,
  writeStoredProgress,
  normalizeProgress,
  buildPointOrderMap,
  resolvePointOrder,
  enumeratePoints,
} from './reading-state.js';

const mapColumn = document.querySelector('[data-map-column]');
const progressTrack = document.querySelector('[data-map-progress-track]');
const progressFill = document.querySelector('[data-map-progress-fill]');
const progressMarkers = document.querySelector('[data-map-progress-markers]');
const progressLabels = document.querySelector('[data-map-progress-labels]');
const progressPointer = document.querySelector('[data-map-progress-pointer]');
const progressCaption = document.querySelector('[data-map-progress-caption]');

let bookDataRef = null;
let unlockSet = new Set();
let pointOrderMap = new Map();
let structureMeta = new Map();
let progressState = null;
let progressIndex = 0;
let timelineEntries = [];
let syncFrame = 0;
let totalPoints = 0;
let currentPointerEntry = null;
let hasAutoScrolled = false;

function scheduleProgressSync() {
  cancelAnimationFrame(syncFrame);
  syncFrame = window.requestAnimationFrame(() => {
    syncFrame = 0;
    syncProgressLayout();
  });
}

if (!mapColumn) {
  console.warn('[Map] РєРѕРЅС‚РµР№РЅРµСЂ РєР°СЂС‚С‹ РЅРµ РЅР°Р№РґРµРЅ, РѕС‚СЂРёСЃРѕРІРєР° РїСЂРѕРїСѓС‰РµРЅР°');
} else {
  initializeMap();
  mapColumn.addEventListener('click', handleMapCardClick);
}

window.addEventListener('load', scheduleProgressSync);
window.addEventListener('resize', scheduleProgressSync);

function initializeMap() {
  loadBookData()
    .then((data) => {
      bookDataRef = data;
      const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
      if (chapters.length === 0) {
        console.warn('[Map] СЃС‚СЂСѓРєС‚СѓСЂР° РєРЅРёРіРё РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚');
        renderEmptyState();
        return;
      }

      const chapterIds = chapters.map((chapter) => chapter.id).filter(Boolean);
      const unlockResult = loadChapterUnlocks(
        chapterIds,
        data.defaultChapterId ?? chapterIds[0] ?? null
      );
      unlockSet = unlockResult.unlocks;
      if (unlockResult.changed) {
        persistChapterUnlocks(unlockSet);
      }

      const storedProgress = readStoredProgress();
      const normalizedProgress =
        normalizeProgress(storedProgress, data) ?? {
          chapterId: data.defaultChapterId ?? chapterIds[0] ?? null,
          sectionId: data.defaultSectionId ?? chapters[0]?.sections?.[0]?.id ?? null,
          pointId: data.defaultPointId ?? chapters[0]?.sections?.[0]?.points?.[0]?.id ?? null,
          chunkIndex: 0,
        };

      progressState = normalizedProgress;

      pointOrderMap = buildPointOrderMap(data);
      progressIndex = resolvePointOrder(
        pointOrderMap,
        normalizedProgress.chapterId,
        normalizedProgress.sectionId,
        normalizedProgress.pointId
      );
      if (!Number.isFinite(progressIndex) || progressIndex < 0) {
        progressIndex = 0;
      }

      totalPoints = Math.max(enumeratePoints(data).length, 1);
      structureMeta = buildStructureMeta(chapters);
      currentPointerEntry = null;
      hasAutoScrolled = false;

      renderTimeline(chapters);
      renderChapters(chapters);
      updateProgressCaption();

      console.info(
        '[Map] РїСЂРѕРіСЂРµСЃСЃ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°РЅ: chapter=%s section=%s point=%s index=%d/%d',
        normalizedProgress.chapterId ?? '?',
        normalizedProgress.sectionId ?? '?',
        normalizedProgress.pointId ?? '?',
        progressIndex + 1,
        totalPoints
      );
    })
    .catch((error) => {
      console.error('[Map] РЅРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°РЅРЅС‹Рµ РєРЅРёРіРё', error);
      renderEmptyState();
    });
}

function renderEmptyState() {
  if (!mapColumn) {
    return;
  }
  mapColumn.innerHTML = '';
  const message = document.createElement('p');
  message.className = 'map-empty';
  message.textContent = 'РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… РґР°РЅРЅС‹С… РґР»СЏ РєР°СЂС‚С‹.';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  mapColumn.appendChild(message);
}

function renderTimeline(chapters) {
  if (!progressPointer) {
    return;
  }
  timelineEntries = [];
  progressLabels?.replaceChildren();
  progressMarkers?.replaceChildren();

  chapters.forEach((chapter, chapterIndex) => {
    const chapterMeta = structureMeta.get(chapter.id);
    const chapterStatus = resolveChapterStatus(chapter, chapterMeta);

    timelineEntries.push({
      type: 'chapter',
      chapterId: chapter.id,
      sectionId: null,
      pointId: null,
      label: buildChapterLabel(chapterIndex),
      status: chapterStatus,
    });

    const sections = Array.isArray(chapter.sections) ? chapter.sections : [];
    sections.forEach((section, sectionIndex) => {
      const firstPointId = section.points?.[0]?.id ?? null;
      const sectionStatus = resolveSectionStatus(chapter.id, section, chapterMeta);
      timelineEntries.push({
        type: 'section',
        chapterId: chapter.id,
        sectionId: section.id,
        pointId: firstPointId,
        label: buildSectionLabel(chapterIndex, sectionIndex),
        status: sectionStatus,
      });
    });
  });

  scheduleProgressSync();
}
function renderChapters(chapters) {
  if (!mapColumn) {
    return;
  }
  mapColumn.innerHTML = '';
  const fragment = document.createDocumentFragment();

  chapters.forEach((chapter, chapterIndex) => {
    const chapterMeta = structureMeta.get(chapter.id);
    const stage = document.createElement('section');
    stage.className = 'map-stage';
    stage.dataset.chapterId = chapter.id;

    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'map-stage__sections';

    const sections = Array.isArray(chapter.sections) ? chapter.sections : [];
    sections.forEach((section, sectionIndex) => {
      const sectionStatus = resolveSectionStatus(chapter.id, section, chapterMeta);
      const firstPointId = section.points?.[0]?.id ?? null;
      const sectionCard = createMapCard({
        kind: 'section',
        title: section.title,
        subtitle: buildSectionSubtitle(chapterIndex, sectionIndex),
        status: sectionStatus,
        locked: sectionStatus === 'locked',
        href:
          sectionStatus === 'locked'
            ? null
            : buildReaderHref({
                chapterId: chapter.id,
                sectionId: section.id,
                pointId:
                  sectionStatus === 'current'
                    ? progressState?.pointId ?? firstPointId
                    : firstPointId,
              }),
        dataset: {
          chapterId: chapter.id,
          sectionId: section.id,
          pointId:
            sectionStatus === 'current'
              ? progressState?.pointId ?? firstPointId ?? ''
              : firstPointId ?? '',
        },
      });
      sectionsWrap.appendChild(sectionCard);
    });

    if (sections.length > 0) {
      stage.appendChild(sectionsWrap);
    }

    const firstSection = sections[0] ?? null;
    const firstPoint =
      firstSection?.points && firstSection.points.length > 0 ? firstSection.points[0] : null;
    const chapterStatus = resolveChapterStatus(chapter, chapterMeta);
    const chapterLocked = chapterStatus === 'locked';
    const chapterCard = createMapCard({
      kind: 'chapter',
      title: chapter.title,
      subtitle: buildChapterSubtitle(chapterIndex, chapter),
      status: chapterStatus,
      locked: chapterLocked,
      href:
        chapterLocked || !firstSection
          ? null
          : buildReaderHref({
              chapterId: chapter.id,
              sectionId:
                chapterStatus === 'current'
                  ? progressState?.sectionId ?? firstSection.id
                  : firstSection.id,
              pointId:
                chapterStatus === 'current'
                  ? progressState?.pointId ?? firstPoint?.id ?? null
                  : firstPoint?.id ?? null,
            }),
      dataset: {
        chapterId: chapter.id,
        sectionId:
          chapterStatus === 'current'
            ? progressState?.sectionId ?? firstSection?.id ?? ''
            : firstSection?.id ?? '',
        pointId:
          chapterStatus === 'current'
            ? progressState?.pointId ?? firstPoint?.id ?? ''
            : firstPoint?.id ?? '',
      },
    });
    stage.appendChild(chapterCard);

    fragment.appendChild(stage);
  });

  mapColumn.appendChild(fragment);
  scheduleProgressSync();
}

function syncProgressLayout() {
  if (!mapColumn || !progressTrack || !progressPointer || timelineEntries.length === 0) {
    return;
  }

  const columnRect = mapColumn.getBoundingClientRect();
  const columnHeight = columnRect.height;
  if (!Number.isFinite(columnHeight) || columnHeight <= 0) {
    return;
  }

  const trackHeight = Math.max(columnHeight, 0);
  progressTrack.style.height = `${trackHeight}px`;
  progressTrack.style.minHeight = `${trackHeight}px`;
  progressTrack.style.maxHeight = `${trackHeight}px`;

  progressMarkers?.replaceChildren();
  progressLabels?.replaceChildren();

  let pointerPercent = null;
  let pointerRank = 0;
  let pointerEntry = null;

  timelineEntries.forEach((entry) => {
    const targetCard = findCardForEntry(entry);
    if (!targetCard) {
      return;
    }
    const percent = computePercentForCard(targetCard, columnRect, columnHeight);
    const percentValue = `${percent}%`;
    const matchRank = entryMatchRank(entry);

    if (progressMarkers) {
      const marker = document.createElement('div');
      marker.className = 'map-progress__marker';
      marker.style.bottom = percentValue;
      if (entry.status) {
        marker.dataset.status = entry.status;
      }
      if (matchRank > 0) {
        marker.dataset.active = 'true';
      }
      progressMarkers.appendChild(marker);
    }

    if (progressLabels) {
      const labelEl = document.createElement('span');
      labelEl.className = 'map-progress__label';
      labelEl.textContent = entry.label;
      labelEl.style.bottom = percentValue;
      if (entry.status) {
        labelEl.dataset.status = entry.status;
      }
      if (matchRank > 0) {
        labelEl.dataset.active = 'true';
      }
      progressLabels.appendChild(labelEl);
    }

    if (matchRank > pointerRank) {
      pointerPercent = percent;
      pointerRank = matchRank;
      pointerEntry = entry;
    }
  });

  if (pointerPercent === null) {
    pointerPercent = computeFallbackPercent();
  }
  if (!pointerEntry) {
    pointerEntry = resolveEntryForProgress();
  }
  currentPointerEntry = pointerEntry;

  const bounded = Math.max(0, Math.min(100, pointerPercent));
  progressPointer.style.bottom = `${bounded}%`;
  progressPointer.title = buildProgressTooltip();
  if (progressFill) {
    progressFill.style.height = `${bounded}%`;
    if (pointerEntry?.status) {
      progressFill.dataset.status = pointerEntry.status;
    } else {
      progressFill.removeAttribute('data-status');
    }
  }
  const pointerFlag = progressPointer.querySelector('.map-progress__pointer-flag');
  if (pointerFlag) {
    pointerFlag.textContent = buildProgressPointerLabel();
  }
  if (pointerEntry?.status) {
    progressPointer.dataset.status = pointerEntry.status;
  } else {
    progressPointer.removeAttribute('data-status');
  }

  alignViewToProgress();
}
function findCardForEntry(entry) {
  if (!mapColumn) {
    return null;
  }
  if (entry.type === 'chapter') {
    return mapColumn.querySelector(`.map-card--chapter[data-chapter-id="${entry.chapterId}"]`);
  }
  if (entry.type === 'section') {
    return mapColumn.querySelector(
      `.map-card--section[data-chapter-id="${entry.chapterId}"][data-section-id="${entry.sectionId}"]`
    );
  }
  return null;
}

function computePercentForCard(card, columnRect, columnHeight) {
  const cardRect = card.getBoundingClientRect();
  const cardCenter = cardRect.top + cardRect.height / 2;
  const distanceFromBottom = columnRect.bottom - cardCenter;
  const ratio = columnHeight > 0 ? distanceFromBottom / columnHeight : 0;
  return Math.max(0, Math.min(1, ratio)) * 100;
}

function entryMatchRank(entry) {
  if (!progressState) {
    return 0;
  }
  if (
    entry.type === 'section' &&
    entry.chapterId === progressState.chapterId &&
    entry.sectionId === progressState.sectionId
  ) {
    return 2;
  }
  if (entry.type === 'chapter' && entry.chapterId === progressState.chapterId) {
    return 1;
  }
  return 0;
}

function buildProgressPointerLabel() {
  if (!progressState) {
    return '—';
  }
  const chapterCode = extractChapterCode(progressState.chapterId);
  if (chapterCode === null) {
    return '—';
  }
  const sectionCode = extractSectionCode(progressState.sectionId);
  const pointCode = extractPointCode(progressState.pointId);

  let label = String(chapterCode);
  if (sectionCode !== null) {
    label += `.${sectionCode}`;
  }
  if (pointCode !== null) {
    label += `.${pointCode}`;
  }
  return label;
}

function extractChapterCode(chapterId) {
  if (!chapterId) {
    return null;
  }
  const match = /chapter-(\d+)/i.exec(chapterId);
  if (!match) {
    return null;
  }
  const raw = parseInt(match[1], 10);
  if (!Number.isFinite(raw)) {
    return null;
  }
  return Math.max(0, raw - 1);
}

function extractSectionCode(sectionId) {
  if (!sectionId) {
    return null;
  }
  const match = /section-\d{2}-(\d{2})/i.exec(sectionId);
  if (!match) {
    return null;
  }
  const raw = parseInt(match[1], 10);
  return Number.isFinite(raw) ? raw : null;
}

function extractPointCode(pointId) {
  if (!pointId) {
    return null;
  }
  const match = /point-\d{2}-\d{2}-(\d{2})/i.exec(pointId);
  if (!match) {
    return null;
  }
  const raw = parseInt(match[1], 10);
  return Number.isFinite(raw) ? raw : null;
}

function resolveEntryForProgress() {
  if (!progressState || !timelineEntries.length) {
    return null;
  }
  const { chapterId, sectionId } = progressState;
  if (chapterId && sectionId) {
    const sectionEntry = timelineEntries.find(
      (entry) => entry.type === 'section' && entry.chapterId === chapterId && entry.sectionId === sectionId
    );
    if (sectionEntry) {
      return sectionEntry;
    }
  }
  if (chapterId) {
    const chapterEntry = timelineEntries.find(
      (entry) => entry.type === 'chapter' && entry.chapterId === chapterId
    );
    if (chapterEntry) {
      return chapterEntry;
    }
  }
  return null;
}

function findCurrentProgressCard() {
  if (!mapColumn || !progressState?.chapterId) {
    return null;
  }
  if (progressState.sectionId) {
    const sectionCard = mapColumn.querySelector(
      '.map-card--section[data-chapter-id="' + progressState.chapterId + '"][data-section-id="' + progressState.sectionId + '"]'
    );
    if (sectionCard) {
      return sectionCard;
    }
  }
  return mapColumn.querySelector(
    '.map-card--chapter[data-chapter-id="' + progressState.chapterId + '"]'
  );
}

function alignViewToProgress() {
  if (hasAutoScrolled) {
    return;
  }
  const entry = currentPointerEntry ?? resolveEntryForProgress();
  let targetCard = entry ? findCardForEntry(entry) : null;
  if (!targetCard) {
    targetCard = findCurrentProgressCard();
  }
  if (!targetCard) {
    return;
  }
  targetCard.scrollIntoView({ block: 'center', behavior: 'auto' });
  hasAutoScrolled = true;
}

function computeFallbackPercent() {
  if (!timelineEntries.length) {
    return 0;
  }
  const ratio = totalPoints > 0 ? (progressIndex + 0.5) / totalPoints : 0;
  return Math.max(0, Math.min(1, ratio)) * 100;
}

function createMapCard({ kind, title, subtitle, status, locked, href, dataset }) {
  const isLink = Boolean(href) && !locked;
  const element = document.createElement(isLink ? 'a' : 'button');
  element.className = `map-card map-card--${kind}`;
  element.dataset.role = 'map-card';
  element.dataset.status = status;
  element.classList.add(`map-card--status-${status}`);

  if (isLink) {
    element.href = href;
  } else {
    element.type = 'button';
  }

  if (locked) {
    element.dataset.locked = 'true';
  }

  Object.entries(dataset || {}).forEach(([key, value]) => {
    if (value) {
      element.dataset[key] = value;
    }
  });

  const cover = document.createElement('div');
  cover.className = 'map-card__cover';
  cover.setAttribute('aria-hidden', 'true');
  cover.textContent = resolveCoverSymbol(status, kind);

  element.append(cover);
  return element;
}

function resolveCoverSymbol(status, kind) {
  if (status === 'locked') {
    return '🔒';
  }
  if (status === 'completed') {
    return kind === 'chapter' ? '★' : '✓';
  }
  if (status === 'current') {
    return '▶';
  }
  return '?';
}

function buildChapterLabel(chapterIndex) {
  return String(chapterIndex);
}

function buildChapterSubtitle(chapterIndex, chapter) {
  if (chapterIndex === 0) {
    return 'Пролог';
  }
  return 'Глава ' + chapterIndex;
}

function buildSectionSubtitle(chapterIndex, sectionIndex) {
  return 'Часть ' + chapterIndex + '.' + (sectionIndex + 1);
}

function buildSectionLabel(chapterIndex, sectionIndex) {
  return chapterIndex + '.' + (sectionIndex + 1);
}

function updateProgressCaption() {
  if (!progressCaption) {
    return;
  }
  progressCaption.textContent = buildProgressTooltip();
}

function buildProgressTooltip() {
  const parts = [];
  const chapter = bookDataRef?.books?.[progressState?.chapterId ?? ''];
  if (chapter?.title) {
    parts.push(chapter.title);
  }
  const section = chapter?.sections?.[progressState?.sectionId ?? ''];
  if (section?.title) {
    parts.push(section.title);
  }
  const point = section?.points?.[progressState?.pointId ?? ''];
  if (point?.title) {
    parts.push(point.title);
  }
  if (parts.length === 0) {
    return 'Прогресс ещё не начат.';
  }
  return `Текущий пункт: ${parts.join(' → ')}`;
}

function handleMapCardClick(event) {
  const card = event.target.closest('[data-role="map-card"]');
  if (!card || !mapColumn.contains(card)) {
    return;
  }
  if (card.dataset.locked === 'true') {
    return;
  }

  const chapterId = card.dataset.chapterId;
  if (!chapterId) {
    return;
  }
  const sectionId = card.dataset.sectionId || null;
  const pointId = card.dataset.pointId || null;
  const selection = resolveSelectionTarget({ chapterId, sectionId, pointId });
  if (!selection) {
    console.warn('[Map] РЅРµ СѓРґР°Р»РѕСЃСЊ РІС‹С‡РёСЃР»РёС‚СЊ РїСѓРЅРєС‚ РґР»СЏ РїРµСЂРµС…РѕРґР°');
    return;
  }

  event.preventDefault();
  const unlocked = ensureChapterUnlocked(unlockSet, selection.chapterId);
  if (unlocked) {
    persistChapterUnlocks(unlockSet);
  }
  writeStoredProgress({
    chapterId: selection.chapterId,
    sectionId: selection.sectionId,
    pointId: selection.pointId,
    chunkIndex: 0,
    timestamp: Date.now(),
  });
  window.location.href = buildReaderHref(selection);
}

function resolveSelectionTarget({ chapterId, sectionId, pointId }) {
  const chapter = bookDataRef?.books?.[chapterId ?? ''];
  if (!chapter) {
    return null;
  }

  let resolvedSectionId = sectionId && chapter.sections?.[sectionId] ? sectionId : null;
  if (!resolvedSectionId) {
    const sectionKeys = Object.keys(chapter.sections ?? {});
    resolvedSectionId = sectionKeys[0] ?? null;
  }
  const section = chapter.sections?.[resolvedSectionId ?? ''];
  if (!section) {
    return null;
  }

  let resolvedPointId = pointId && section.points?.[pointId] ? pointId : null;
  if (!resolvedPointId) {
    const pointKeys = Object.keys(section.points ?? {});
    resolvedPointId = pointKeys[0] ?? null;
  }

  if (!resolvedPointId || !section.points?.[resolvedPointId]) {
    return null;
  }

  return {
    chapterId,
    sectionId: resolvedSectionId,
    pointId: resolvedPointId,
  };
}

function buildReaderHref({ chapterId, sectionId, pointId }) {
  const params = new URLSearchParams();
  if (chapterId) {
    params.set('chapter', chapterId);
  }
  if (sectionId) {
    params.set('section', sectionId);
  }
  if (pointId) {
    params.set('point', pointId);
  }
  return `reader.html?${params.toString()}`;
}

function buildStructureMeta(chapters) {
  const meta = new Map();

  chapters.forEach((chapter) => {
    const sectionMeta = new Map();
    let chapterFirst = Number.POSITIVE_INFINITY;
    let chapterLast = -1;

    chapter.sections?.forEach((section) => {
      let sectionFirst = Number.POSITIVE_INFINITY;
      let sectionLast = -1;

      section.points?.forEach((point) => {
        const orderIndex = resolvePointOrder(pointOrderMap, chapter.id, section.id, point.id);
        if (Number.isFinite(orderIndex) && orderIndex >= 0) {
          sectionFirst = Math.min(sectionFirst, orderIndex);
          sectionLast = Math.max(sectionLast, orderIndex);
          chapterFirst = Math.min(chapterFirst, orderIndex);
          chapterLast = Math.max(chapterLast, orderIndex);
        }
      });

      sectionMeta.set(section.id, {
        firstIndex: sectionFirst === Number.POSITIVE_INFINITY ? -1 : sectionFirst,
        lastIndex: sectionLast,
      });
    });

    meta.set(chapter.id, {
      firstIndex: chapterFirst === Number.POSITIVE_INFINITY ? -1 : chapterFirst,
      lastIndex: chapterLast,
      sections: sectionMeta,
    });
  });

  return meta;
}

function resolveChapterStatus(chapter, chapterMeta) {
  if (isChapterLocked(unlockSet, chapter.id)) {
    return 'locked';
  }
  if (progressState?.chapterId && chapter.id === progressState.chapterId) {
    return 'current';
  }
  if (chapterMeta && chapterMeta.lastIndex >= 0 && progressIndex > chapterMeta.lastIndex) {
    return 'completed';
  }
  return 'pending';
}

function resolveSectionStatus(chapterId, section, chapterMeta) {
  if (isChapterLocked(unlockSet, chapterId)) {
    return 'locked';
  }

  if (
    progressState?.chapterId === chapterId &&
    progressState?.sectionId === section.id
  ) {
    return 'current';
  }

  const meta = chapterMeta?.sections?.get(section.id);
  if (!meta) {
    return 'pending';
  }
  if (meta.lastIndex >= 0 && progressIndex > meta.lastIndex) {
    return 'completed';
  }
  if (
    meta.firstIndex >= 0 &&
    progressIndex >= meta.firstIndex &&
    progressIndex <= meta.lastIndex
  ) {
    return 'current';
  }
  return 'pending';
}








