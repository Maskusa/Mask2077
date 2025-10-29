import { loadBookData } from './book-data.js';

const PROGRESS_KEY = 'mask2077:reader-progress';
const progressCard = document.querySelector('[data-progress-card]');

if (!progressCard) {
  console.warn('[Lobby] Карточка прогресса не найдена');
} else {
  console.info('[Lobby] Инициализация карточки прогресса');
  loadBookData()
    .then((data) => {
      const storedProgress = readProgress();
      const fallback = {
        chapterId: data.defaultChapterId,
        sectionId: data.defaultSectionId,
        pointId: data.defaultPointId,
        chunkIndex: 0,
      };
      const normalized = normalizeProgress(storedProgress, data);
      if (normalized) {
        console.info(
          '[Lobby] Используем сохранённый прогресс: %s / %s / %s',
          normalized.chapterId,
          normalized.sectionId,
          normalized.pointId
        );
        updateCard(progressCard, data, normalized);
      } else {
        console.info('[Lobby] Прогресс отсутствует, используем значения по умолчанию');
        updateCard(progressCard, data, fallback);
      }
    })
    .catch((error) => {
      console.error('[Lobby] Не удалось загрузить данные книги', error);
    });
}

function readProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('[Lobby] Ошибка чтения прогресса', error);
    return null;
  }
}

function normalizeProgress(progress, data) {
  if (!progress || typeof progress !== 'object') {
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

function buildSequence(data) {
  const sequence = [];
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

function updateCard(card, data, progress) {
  const sequence = buildSequence(data);
  const total = sequence.length;
  const currentIndex = sequence.findIndex(
    (item) =>
      item.chapterId === progress.chapterId &&
      item.sectionId === progress.sectionId &&
      item.pointId === progress.pointId
  );

  const current =
    currentIndex >= 0
      ? sequence[currentIndex]
      : {
          chapterTitle: data.books?.[progress.chapterId]?.title ?? 'Mask 2077',
          sectionTitle:
            data.books?.[progress.chapterId]?.sections?.[progress.sectionId]?.title ?? null,
          pointTitle:
            data.books?.[progress.chapterId]?.sections?.[progress.sectionId]?.points?.[
              progress.pointId
            ]?.title ?? null,
        };

  const eyebrow = card.querySelector('.lobby-card__eyebrow');
  const title = card.querySelector('.lobby-card__title');
  const note = card.querySelector('.lobby-card__note');

  if (eyebrow) {
    eyebrow.textContent = current.chapterTitle || 'Mask 2077';
  }
  if (title) {
    title.textContent = current.sectionTitle || current.chapterTitle || 'Начните чтение';
  }
  if (note) {
    const label =
      currentIndex >= 0 && total > 0
        ? `Фрагмент ${currentIndex + 1} из ${total}`
        : 'Фрагмент 1 из 1';
    note.textContent = current.pointTitle ? `${label} • ${current.pointTitle}` : label;
  }

  const targetUrl = buildContentUrl(progress);
  if (targetUrl) {
    card.setAttribute('href', targetUrl);
  }

  console.info(
    '[Lobby] Прогресс обновлён: %s → %s → %s (фрагмент %d из %d)',
    progress.chapterId,
    progress.sectionId,
    progress.pointId,
    currentIndex >= 0 ? currentIndex + 1 : 1,
    total > 0 ? total : 1
  );
}

function buildContentUrl({ chapterId, sectionId, pointId }) {
  const params = new URLSearchParams();
  if (chapterId) params.set('chapter', chapterId);
  if (sectionId) params.set('section', sectionId);
  if (pointId) params.set('point', pointId);
  return `content.html?${params.toString()}`;
}
