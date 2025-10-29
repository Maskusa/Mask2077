import { loadBookData } from './book-data.js';

const PROGRESS_KEY = 'mask2077:reader-progress';

const contentList = document.querySelector('.content-list');

if (!contentList) {
  console.warn('[Content] list element not found');
} else {
  console.info('[Content] Запуск загрузки содержания');
  loadBookData()
    .then((data) => {
      const chapters = data?.chapters ?? [];
      const totalPoints = chapters.reduce((acc, chapter) => {
        const sections = chapter.sections ?? [];
        return (
          acc +
          sections.reduce((innerAcc, section) => innerAcc + (section.points?.length ?? 0), 0)
        );
      }, 0);
      console.info('[Content] Содержание считано: глав=%d, пунктов=%d', chapters.length, totalPoints);
      const progress = normalizeProgress(readProgress(), data) ?? {
        chapterId: data.defaultChapterId,
        sectionId: data.defaultSectionId,
        pointId: data.defaultPointId,
      };
      renderContent(chapters, progress, data);
    })
    .catch((error) => {
      console.error('[Content] failed to load book data', error);
      showError();
    });
}

function renderContent(chapters, progress, data) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    showError();
    return;
  }
  contentList.innerHTML = '';
  contentList.setAttribute('role', 'list');

  const fragments = document.createDocumentFragment();
  let renderedItems = 0;

  chapters.forEach((chapter, chapterIndex) => {
    fragments.appendChild(
      createContentItem({
        level: 0,
        title: chapter.title,
        href: buildReaderHref({ chapterId: chapter.id }),
        marker: deriveMarker(chapter.title, String(chapterIndex + 1)),
        isCurrent: progress?.chapterId === chapter.id && !progress.sectionId,
      })
    );
    renderedItems += 1;

    chapter.sections?.forEach((section, sectionIndex) => {
      fragments.appendChild(
        createContentItem({
          level: 1,
          title: section.title,
          href: buildReaderHref({ chapterId: chapter.id, sectionId: section.id }),
          marker: deriveMarker(section.title, `${chapterIndex + 1}.${sectionIndex + 1}`),
          isCurrent:
            progress?.chapterId === chapter.id &&
            progress?.sectionId === section.id &&
            !progress.pointId,
        })
      );
      renderedItems += 1;

      section.points?.forEach((point, pointIndex) => {
        fragments.appendChild(
          createContentItem({
            level: 2,
            title: point.title,
            href: buildReaderHref({
              chapterId: chapter.id,
              sectionId: section.id,
              pointId: point.id,
            }),
            marker: deriveMarker(
              point.title,
              `${chapterIndex + 1}.${sectionIndex + 1}.${pointIndex + 1}`
            ),
            isCurrent:
              progress?.chapterId === chapter.id &&
              progress?.sectionId === section.id &&
              progress?.pointId === point.id,
          })
        );
        renderedItems += 1;
      });
    });
  });

  contentList.appendChild(fragments);
  contentList.dataset.status = 'ready';
  console.info('[Content] Содержание построено: элементов=%d', renderedItems);

  highlightFromQuery(data);
}

function highlightFromQuery(data) {
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
    console.info('[Content] Подсвечен элемент из query-параметров: %s', target.href);
  }
}

function createContentItem({ level, title, href, marker, isCurrent }) {
  const link = document.createElement('a');
  link.className = 'content-item';
  link.dataset.level = String(level);
  link.href = href;
  link.setAttribute('role', 'listitem');

  const markerSpan = document.createElement('span');
  markerSpan.className = 'content-item__marker';
  markerSpan.textContent = marker || '-';

  const info = document.createElement('div');
  info.className = 'content-item__info';
  const titleElement = document.createElement('h4');
  titleElement.textContent = title;
  info.appendChild(titleElement);

  if (isCurrent) {
    link.classList.add('content-item--current');
    markerSpan.classList.add('content-item__marker--current');
  }

  link.append(markerSpan, info);
  return link;
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
  message.textContent = 'Не удалось загрузить содержание.';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  contentList.appendChild(message);
  console.warn('[Content] Не удалось построить содержание');
}

function readProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[Content] Ошибка чтения прогресса', error);
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
  };
}

function deriveMarker(title, fallback) {
  if (typeof title === 'string') {
    const numeric = title.match(/(\d+(?:\.\d+)+)/);
    if (numeric) {
      return numeric[1];
    }
    const leading = title.match(/^(\d+)/);
    if (leading) {
      return leading[1];
    }
  }
  return fallback;
}
