import { loadBookData } from './book-data.js';
import {
  readStoredProgress,
  writeStoredProgress,
  normalizeProgress,
  buildPointOrderMap,
  resolvePointOrder,
  loadChapterUnlocks,
  persistChapterUnlocks,
  ensureChapterUnlocked,
  isChapterLocked,
} from './reading-state.js';

const contentList = document.querySelector('.content-list');

let bookDataRef = null;
let unlockSet = new Set();
let pointOrderMap = new Map();
let progressState = null;
let progressIndex = 0;

if (!contentList) {
  console.warn('[Content] list element not found');
} else {
  contentList.dataset.status = 'loading';
  loadBookData()
    .then((data) => {
      bookDataRef = data;
      const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
      if (!chapters.length) {
        console.warn('[Content] chapters list is empty');
        showError();
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

      pointOrderMap = buildPointOrderMap(data);

      const storedProgress = readStoredProgress();
      const normalizedProgress =
        normalizeProgress(storedProgress, data) ?? {
          chapterId: data.defaultChapterId,
          sectionId: data.defaultSectionId,
          pointId: data.defaultPointId,
          chunkIndex: 0,
        };

      progressState = normalizedProgress;
      progressIndex = resolvePointOrder(
        pointOrderMap,
        normalizedProgress.chapterId,
        normalizedProgress.sectionId,
        normalizedProgress.pointId
      );
      if (!Number.isFinite(progressIndex) || progressIndex < 0) {
        progressIndex = 0;
      }

      console.info(
        '[Content] progression loaded: chapter=%s section=%s point=%s index=%d',
        normalizedProgress.chapterId ?? '?',
        normalizedProgress.sectionId ?? '?',
        normalizedProgress.pointId ?? '?',
        progressIndex + 1
      );

      renderContent(chapters);
      contentList.dataset.status = 'ready';
      highlightFromQuery(data);
    })
    .catch((error) => {
      console.error('[Content] failed to load book data', error);
      showError();
    });

  contentList.addEventListener('click', handleContentClick);
}

function renderContent(chapters) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    showError();
    return;
  }

  const structureMeta = buildStructureMeta(chapters);
  const fragment = document.createDocumentFragment();

  contentList.innerHTML = '';
  contentList.setAttribute('role', 'list');

  chapters.forEach((chapter, chapterIndex) => {
    const chapterMeta = structureMeta.get(chapter.id) ?? {
      firstIndex: -1,
      lastIndex: -1,
      sections: new Map(),
    };
    const chapterLocked = isChapterLocked(unlockSet, chapter.id);
    const chapterStatus = resolveChapterStatus(chapter, chapterMeta);

    fragment.appendChild(
      createContentItem({
        type: 'chapter',
        level: 0,
        title: chapter.title,
        href: buildReaderHref({ chapterId: chapter.id }),
        status: chapterStatus,
        locked: chapterLocked,
        dataset: { chapterId: chapter.id },
      })
    );

    chapter.sections?.forEach((section, sectionIndex) => {
      const sectionStatus = resolveSectionStatus(chapter.id, section, chapterMeta);
      const sectionLocked = chapterLocked;

      fragment.appendChild(
      createContentItem({
        type: 'section',
        level: 1,
        title: section.title,
        href: buildReaderHref({ chapterId: chapter.id, sectionId: section.id }),
        status: sectionStatus,
        locked: sectionLocked,
        dataset: { chapterId: chapter.id, sectionId: section.id },
        })
      );

      section.points?.forEach((point, pointIndex) => {
        const pointStatus = resolvePointStatus(chapter.id, section.id, point);
        const pointLocked = chapterLocked;

        fragment.appendChild(
      createContentItem({
        type: 'point',
        level: 2,
        title: point.title,
        href: buildReaderHref({
          chapterId: chapter.id,
          sectionId: section.id,
          pointId: point.id,
            }),
            status: pointStatus,
            locked: pointLocked,
            dataset: {
              chapterId: chapter.id,
              sectionId: section.id,
              pointId: point.id,
            },
          })
        );
      });
    });
  });

  contentList.appendChild(fragment);
  console.info('[Content] rendered items: %d', fragment.childNodes.length);
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
  if (
    progressState?.chapterId &&
    chapter.id === progressState.chapterId
  ) {
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

function resolvePointStatus(chapterId, sectionId, point) {
  if (isChapterLocked(unlockSet, chapterId)) {
    return 'locked';
  }

  if (
    progressState?.chapterId === chapterId &&
    progressState?.sectionId === sectionId &&
    progressState?.pointId === point.id
  ) {
    return 'current';
  }

  const orderIndex = resolvePointOrder(pointOrderMap, chapterId, sectionId, point.id);
  if (Number.isFinite(orderIndex) && orderIndex >= 0 && orderIndex < progressIndex) {
    return 'completed';
  }
  return 'pending';
}

function createContentItem({ type, level, title, href, status, locked, dataset }) {
  const link = document.createElement('a');
  link.className = 'content-item';
  link.classList.add(`content-item--${type}`);
  link.dataset.level = String(level);
  link.dataset.type = type;
  link.dataset.locked = locked ? 'true' : 'false';
  link.dataset.status = status;
  link.href = href;
  link.setAttribute('role', 'listitem');

  if (locked) {
    link.classList.add('content-item--locked');
  }
  if (status === 'current') {
    link.classList.add('content-item--current');
    link.setAttribute('aria-current', 'true');
  } else if (status === 'completed') {
    link.classList.add('content-item--completed');
  }

  if (dataset && typeof dataset === 'object') {
    Object.entries(dataset).forEach(([key, value]) => {
      if (value) {
        link.dataset[key] = value;
      }
    });
  }

  const marker = document.createElement('span');
  marker.className = `content-item__marker content-item__marker--${status}`;
  marker.setAttribute('aria-hidden', 'true');

  const info = document.createElement('div');
  info.className = 'content-item__info';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'content-item__title';
  titleSpan.textContent = title;
  info.appendChild(titleSpan);

  link.append(marker, info);
  return link;
}

function handleContentClick(event) {
  const item = event.target.closest('.content-item');
  if (!item || !contentList.contains(item)) {
    return;
  }

  const locked = item.dataset.locked === 'true';
  if (locked) {
    event.preventDefault();
    return;
  }
  if (!bookDataRef) {
    return;
  }

  const chapterId = item.dataset.chapterId;
  if (!chapterId) {
    return;
  }

  const sectionId = item.dataset.sectionId || null;
  const pointId = item.dataset.pointId || null;
  const selection = resolveSelectionTarget({ chapterId, sectionId, pointId });
  if (!selection) {
    console.warn('[Content] unable to resolve selection for click');
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
  const chapter = bookDataRef?.books?.[chapterId];
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

function highlightFromQuery(data) {
  if (!contentList) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const chapterId = params.get('chapter');
  const sectionId = params.get('section');
  const pointId = params.get('point');
  if (!chapterId && !sectionId && !pointId) {
    return;
  }

  const selector = [
    chapterId ? `[href*="chapter=${chapterId}"]` : null,
    sectionId ? `[href*="section=${sectionId}"]` : null,
    pointId ? `[href*="point=${pointId}"]` : null,
  ]
    .filter(Boolean)
    .join('');
  const target = selector ? contentList.querySelector(selector) : null;
  if (target) {
    target.classList.add('content-item--focus');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    console.info('[Content] highlighted item via query: %s', target.href);
  }
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

function showError() {
  contentList.dataset.status = 'error';
  contentList.innerHTML = '';
  contentList.removeAttribute('role');
  const message = document.createElement('p');
  message.className = 'content-empty';
  message.textContent = '�� 㤠���� ����㧨�� ᮤ�ঠ���.';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  contentList.appendChild(message);
  console.warn('[Content] unable to render contents');
}


