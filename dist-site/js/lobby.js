import { loadBookData } from './book-data.js';
import { readStoredProgress, normalizeProgress } from './reading-state.js';

const progressCard = document.querySelector('[data-progress-card]');

if (!progressCard) {
  console.warn('[Lobby] ����窠 �ண��� �� �������');
} else {
  console.info('[Lobby] ���樠������ ����窨 �ண���');
  loadBookData()
    .then((data) => {
      const storedProgress = readStoredProgress();
      const normalized = normalizeProgress(storedProgress, data);
      const fallback = {
        chapterId: data.defaultChapterId,
        sectionId: data.defaultSectionId,
        pointId: data.defaultPointId,
        chunkIndex: 0,
      };

      if (normalized) {
        console.info(
          '[Lobby] �ᯮ��㥬 ��࠭�� �ண���: %s / %s / %s',
          normalized.chapterId,
          normalized.sectionId,
          normalized.pointId
        );
        updateCard(progressCard, data, normalized);
      } else {
        console.info('[Lobby] �ண��� ���������, �ᯮ��㥬 ���祭�� �� 㬮�砭��');
        updateCard(progressCard, data, fallback);
      }
    })
    .catch((error) => {
      console.error('[Lobby] �� 㤠���� ����㧨�� ����� �����', error);
    });
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
    title.textContent = current.sectionTitle || current.chapterTitle || '��筨� �⥭��';
  }
  if (note) {
    const label =
      currentIndex >= 0 && total > 0
        ? `�ࠣ���� ${currentIndex + 1} �� ${total}`
        : '�ࠣ���� 1 �� 1';
    note.textContent = current.pointTitle ? `${label}  ${current.pointTitle}` : label;
  }

  const progressCurrentEl = card.querySelector('[data-progress-current]');
  const progressTotalEl = card.querySelector('[data-progress-total]');
  const progressFillEl = card.querySelector('[data-progress-fill]');
  const safeTotal = total > 0 ? total : 1;
  const safeCurrent = currentIndex >= 0 ? currentIndex + 1 : 1;

  if (progressCurrentEl) {
    progressCurrentEl.textContent = String(Math.min(safeCurrent, safeTotal));
  }
  if (progressTotalEl) {
    progressTotalEl.textContent = String(safeTotal);
  }
  if (progressFillEl) {
    const ratio = Math.min(Math.max(safeCurrent / safeTotal, 0), 1);
    progressFillEl.style.width = `${ratio * 100}%`;
  }

  let fillRect;
  let trackRect;
  if (progressFillEl) {
    fillRect = progressFillEl.getBoundingClientRect();
    trackRect = progressFillEl.parentElement?.getBoundingClientRect() ?? null;
  }

  console.debug('[Lobby] progress bar update', {
    total,
    currentIndex,
    safeTotal,
    safeCurrent,
    ratio: safeTotal ? safeCurrent / safeTotal : 0,
    hasFillElement: Boolean(progressFillEl),
    widthStyle: progressFillEl?.style.width ?? null,
    fillRect,
    trackRect,
  });

  const targetUrl = buildContentUrl(progress);
  if (targetUrl) {
    card.setAttribute('href', targetUrl);
  }

  console.info(
    '[Lobby] �ண��� �������: %s  %s  %s (�ࠣ���� %d �� %d)',
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
