const BOOK_ROOT = './book';
const BOOK_FILE_NAME = 'Mask_2077_Book_1_[-RU].epub';
const BOOK_FOLDER_NAME = BOOK_FILE_NAME.replace(/\.epub$/i, '');
const BOOK_HTTP_NAME = encodeURIComponent(BOOK_FOLDER_NAME);
const BOOK_FOLDER = `${BOOK_ROOT}/${BOOK_HTTP_NAME}/GoogleDoc`;
const PACKAGE_FILE = `${BOOK_FOLDER}/package.opf`;
const CONTENT_FILE = `${BOOK_FOLDER}/test_epub.xhtml`;

let cachedBookPromise = null;

export function loadBookData() {
  if (!cachedBookPromise) {
    console.info('[BookLoader] Старт загрузки EPUB по умолчанию');
    cachedBookPromise = fetchBookData();
  } else {
    console.info('[BookLoader] Используем кэшированную структуру книги');
  }
  return cachedBookPromise;
}

async function fetchBookData() {
  console.info('[BookLoader] Читаем файлы манифеста и контента из %s', `${BOOK_ROOT}/${BOOK_FOLDER_NAME}/GoogleDoc`);
  const [packageText, contentText] = await Promise.all([
    fetchText(PACKAGE_FILE),
    fetchText(CONTENT_FILE),
  ]);
  console.info('[BookLoader] Файлы успешно загружены');
  const parser = new DOMParser();
  const packageDocument = parser.parseFromString(packageText, 'application/xml');
  const contentDocument = parser.parseFromString(contentText, 'application/xhtml+xml');

  const meta = extractMeta(packageDocument);
  console.info('[BookLoader] Найдены метаданные: название="%s", язык=%s', meta.title, meta.language);
  const { books, chapters, anchorLookup, totals } = buildBookStructure(contentDocument);
  console.info(
    '[BookLoader] Структура построена: глав=%d, разделов=%d, пунктов=%d',
    totals.chapters,
    totals.sections,
    totals.points
  );

  const defaultChapterId = chapters[0]?.id ?? null;
  const defaultSectionId = chapters[0]?.sections?.[0]?.id ?? null;
  const defaultPointId = chapters[0]?.sections?.[0]?.points?.[0]?.id ?? null;
  if (defaultChapterId && defaultSectionId && defaultPointId) {
    console.info(
      '[BookLoader] Дефолтная цепочка найдена: %s → %s → %s',
      defaultChapterId,
      defaultSectionId,
      defaultPointId
    );
  }

  return {
    meta,
    books,
    chapters,
    anchorLookup,
    defaultChapterId,
    defaultSectionId,
    defaultPointId,
  };
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`[BookLoader] Failed to fetch "${path}": ${response.status}`);
  }
  return response.text();
}

function extractMeta(opfDocument) {
  const title = selectFirstText(opfDocument, ['dc:title', 'title']) ?? 'Mask 2077';
  const language = selectFirstText(opfDocument, ['dc:language', 'language']) ?? 'ru';
  const identifier = selectFirstText(opfDocument, ['dc:identifier', 'identifier']) ?? '';
  return {
    id: identifier,
    title,
    language,
  };
}

function selectFirstText(doc, tagNames) {
  for (const tag of tagNames) {
    const elements = doc.getElementsByTagName(tag);
    if (elements?.length) {
      const value = elements[0].textContent?.trim();
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function formatChapterId(chapterIndex) {
  return `chapter-${String(chapterIndex + 1).padStart(2, '0')}`;
}

function formatSectionId(chapterIndex, sectionIndex) {
  return `section-${String(chapterIndex + 1).padStart(2, '0')}-${String(sectionIndex + 1).padStart(
    2,
    '0'
  )}`;
}

function formatPointId(chapterIndex, sectionIndex, pointIndex) {
  return `point-${String(chapterIndex + 1).padStart(2, '0')}-${String(sectionIndex + 1).padStart(
    2,
    '0'
  )}-${String(pointIndex + 1).padStart(2, '0')}`;
}

function collectParagraphs(headingElement) {
  const paragraphs = [];
  let node = headingElement.nextElementSibling;
  while (node) {
    const tag = node.tagName?.toUpperCase();
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
      break;
    }
    if (tag === 'P') {
      const text = node.textContent?.trim();
      if (text) {
        paragraphs.push(text);
      }
    }
    node = node.nextElementSibling;
  }
  return paragraphs;
}

function buildBookStructure(contentDocument) {
  const { books, chapters, anchorLookup } = internalBuildStructure(contentDocument);
  let sectionTotal = 0;
  let pointTotal = 0;
  chapters.forEach((chapter) => {
    sectionTotal += chapter.sections?.length ?? 0;
    chapter.sections?.forEach((section) => {
      pointTotal += section.points?.length ?? 0;
    });
  });
  return {
    books,
    chapters,
    anchorLookup,
    totals: {
      chapters: chapters.length,
      sections: sectionTotal,
      points: pointTotal,
    },
  };
}

function internalBuildStructure(contentDocument) {
  const headings = getHeadingElements(contentDocument);
  const books = {};
  const chapters = [];
  const anchorLookup = {};
  let currentChapter = null;
  let currentChapterIndex = -1;
  let currentSection = null;
  let currentSectionIndex = -1;

  headings.forEach((heading) => {
    const tag = heading.tagName.toUpperCase();
    const title = heading.textContent?.trim();
    const anchorId = heading.getAttribute('id')?.trim();
    if (!title || !anchorId) {
      return;
    }

    if (tag === 'H1') {
      const chapterIndex = chapters.length;
      const chapterId = formatChapterId(chapterIndex);
      const chapterEntry = {
        id: chapterId,
        title,
        anchorId,
        sections: [],
      };
      chapters.push(chapterEntry);
      books[chapterId] = {
        title,
        anchorId,
        sections: {},
      };
      anchorLookup[anchorId] = {
        type: 'chapter',
        chapterId,
      };
      currentChapter = chapterEntry;
      currentChapterIndex = chapterIndex;
      currentSection = null;
      currentSectionIndex = -1;
      return;
    }

    if (!currentChapter) {
      return;
    }

    if (tag === 'H2') {
      const sectionIndex = currentChapter.sections.length;
      const sectionId = formatSectionId(currentChapterIndex, sectionIndex);
      const sectionEntry = {
        id: sectionId,
        title,
        anchorId,
        points: [],
      };
      currentChapter.sections.push(sectionEntry);
      books[currentChapter.id].sections[sectionId] = {
        title,
        anchorId,
        points: {},
      };
      anchorLookup[anchorId] = {
        type: 'section',
        chapterId: currentChapter.id,
        sectionId,
      };
      currentSection = sectionEntry;
      currentSectionIndex = sectionIndex;
      return;
    }

    if (tag === 'H3' && currentSection) {
      const pointIndex = currentSection.points.length;
      const pointId = formatPointId(currentChapterIndex, currentSectionIndex, pointIndex);
      const text = collectParagraphs(heading);
      const pointEntry = {
        id: pointId,
        title,
        anchorId,
      };
      currentSection.points.push(pointEntry);
      books[currentChapter.id].sections[currentSection.id].points[pointId] = {
        title,
        anchorId,
        text,
      };
      anchorLookup[anchorId] = {
        type: 'point',
        chapterId: currentChapter.id,
        sectionId: currentSection.id,
        pointId,
      };
    }
  });

  return { books, chapters, anchorLookup };
}

function getHeadingElements(contentDocument) {
  if (!contentDocument) {
    return [];
  }

  // Most browsers will match namespaced XHTML via querySelectorAll, but some parsing
  // paths (e.g. DOMParser with application/xhtml+xml locally) return zero results.
  const selectorResult = contentDocument.querySelectorAll?.('h1, h2, h3');
  if (selectorResult?.length) {
    return Array.from(selectorResult);
  }

  const allElements = contentDocument.getElementsByTagName?.('*');
  if (!allElements?.length) {
    return [];
  }

  const headings = [];
  for (const element of allElements) {
    const localName = element.localName?.toLowerCase();
    if (localName === 'h1' || localName === 'h2' || localName === 'h3') {
      headings.push(element);
    }
  }
  return headings;
}
