const PROGRESS_STORAGE_KEY = 'mask2077:reader-progress';
const UNLOCK_STORAGE_KEY = 'mask2077:chapter-unlocks';

/**
 * @returns {object|null}
 */
export function readStoredProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[ReadingState] failed to read stored progress', error);
    return null;
  }
}

/**
 * @param {object} payload
 */
export function writeStoredProgress(payload) {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn('[ReadingState] failed to persist progress', error);
    return false;
  }
}

/**
 * @param {object|null} progress
 * @param {object} data
 */
export function normalizeProgress(progress, data) {
  if (!progress || typeof progress !== 'object' || !data) {
    return null;
  }
  const chapter = data.books?.[progress.chapterId];
  const section = chapter?.sections?.[progress.sectionId];
  const point = section?.points?.[progress.pointId];
  if (!chapter || !section || !point) {
    return null;
  }
  return {
    chapterId: progress.chapterId,
    sectionId: progress.sectionId,
    pointId: progress.pointId,
    chunkIndex: Number.isFinite(progress.chunkIndex) ? progress.chunkIndex : 0,
  };
}

/**
 * @param {object} data
 * @returns {Array}
 */
export function enumeratePoints(data) {
  const sequence = [];
  if (!data || !Array.isArray(data.chapters)) {
    return sequence;
  }
  data.chapters.forEach((chapter) => {
    chapter.sections?.forEach((section) => {
      section.points?.forEach((point) => {
        sequence.push({
          chapterId: chapter.id,
          sectionId: section.id,
          pointId: point.id,
          chapterTitle: chapter.title,
          sectionTitle: section.title,
          pointTitle: point.title,
        });
      });
    });
  });
  return sequence;
}

/**
 * @param {string} chapterId
 * @param {string} sectionId
 * @param {string} pointId
 * @returns {string}
 */
export function createPointKey(chapterId, sectionId, pointId) {
  return [chapterId ?? '', sectionId ?? '', pointId ?? ''].join('|');
}

/**
 * @param {object} data
 * @returns {Map<string, number>}
 */
export function buildPointOrderMap(data) {
  const sequence = enumeratePoints(data);
  const map = new Map();
  sequence.forEach((item, index) => {
    map.set(createPointKey(item.chapterId, item.sectionId, item.pointId), index);
  });
  return map;
}

/**
 * @param {Map<string, number>} orderMap
 * @param {string} chapterId
 * @param {string} sectionId
 * @param {string} pointId
 * @returns {number}
 */
export function resolvePointOrder(orderMap, chapterId, sectionId, pointId) {
  if (!orderMap || !(orderMap instanceof Map)) {
    return -1;
  }
  const key = createPointKey(chapterId, sectionId, pointId);
  return orderMap.has(key) ? orderMap.get(key) : -1;
}

/**
 * @param {Array<string>} validChapterIds
 * @param {string|null} defaultChapterId
 */
export function loadChapterUnlocks(validChapterIds = [], defaultChapterId = null) {
  const unlocks = new Set();
  let changed = false;
  const validSet = new Set(
    Array.isArray(validChapterIds) ? validChapterIds.filter(Boolean) : []
  );

  try {
    const raw = localStorage.getItem(UNLOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && validSet.has(id)) {
            unlocks.add(id);
          }
        });
      }
    }
  } catch (error) {
    console.warn('[ReadingState] failed to read chapter unlocks', error);
  }

  const fallbackId = validSet.has(defaultChapterId) ? defaultChapterId : validChapterIds[0];
  if (fallbackId && !unlocks.has(fallbackId)) {
    unlocks.add(fallbackId);
    changed = true;
  }

  return { unlocks, changed };
}

/**
 * @param {Set<string>} unlocks
 */
export function persistChapterUnlocks(unlocks) {
  if (!(unlocks instanceof Set)) {
    return false;
  }
  try {
    const payload = Array.from(unlocks);
    localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn('[ReadingState] failed to persist chapter unlocks', error);
    return false;
  }
}

/**
 * @param {Set<string>} unlocks
 * @param {string} chapterId
 */
export function ensureChapterUnlocked(unlocks, chapterId) {
  if (!(unlocks instanceof Set) || !chapterId) {
    return false;
  }
  if (unlocks.has(chapterId)) {
    return false;
  }
  unlocks.add(chapterId);
  return true;
}

/**
 * @param {Set<string>} unlocks
 * @param {string} chapterId
 */
export function isChapterLocked(unlocks, chapterId) {
  if (!chapterId) {
    return true;
  }
  if (!(unlocks instanceof Set)) {
    return true;
  }
  return !unlocks.has(chapterId);
}

export { PROGRESS_STORAGE_KEY, UNLOCK_STORAGE_KEY };
