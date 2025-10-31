
import React, { useState, useRef, useLayoutEffect, useMemo } from 'react';
import { Controls } from '../components/Controls';
import { TEXT_CONTENT } from '../constants';
// FIX: Import DebugModal component
import { DebugModal } from '../components/DebugModal';

const PADDING_Y_REM = 2; // Corresponds to Tailwind's p-8 -> 2rem if 1rem=16px
const PADDING_X_REM = 2.5; // Corresponds to Tailwind's px-10 -> 2.5rem

const remToPx = (rem: number) => {
  if (typeof window === 'undefined') return rem * 16;
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
};

interface LineDebugInfo {
  top: number;
  left: number;
  width: number;
  height: number;
  isBad: boolean;
}

interface PageStatsInfo {
    totalLines: number;
    goodLines: number;
    badLines: number;
    emptyLines: number;
    viewerHeight: number;
    contentHeight: number;
}

interface PageContent {
  html: string;
  initialYOffset: number;
  debugLines: LineDebugInfo[];
  stats: PageStatsInfo;
  clipHeight?: number; 
}

const PageStats: React.FC<{ stats: PageStatsInfo }> = ({ stats }) => (
    <div className="bg-gray-900/50 border border-gray-700 rounded-lg text-white text-xs p-2 font-mono grid grid-cols-2 gap-x-4 gap-y-1">
      <div className="flex justify-between"><span>Total:</span><span>{stats.totalLines}</span></div>
      <div className="flex justify-between text-green-400"><span>Good:</span><span>{stats.goodLines}</span></div>
      <div className="flex justify-between text-red-400"><span>Bad:</span><span>{stats.badLines}</span></div>
      <div className="flex justify-between text-gray-400"><span>Empty:</span><span>{stats.emptyLines}</span></div>
      <div className="col-span-2 border-t border-gray-700 pt-1 mt-1"></div>
      <div className="flex justify-between"><span>Viewer H:</span><span>{stats.viewerHeight.toFixed(0)}px</span></div>
      <div className="flex justify-between"><span>Content H:</span><span>{stats.contentHeight.toFixed(0)}px</span></div>
    </div>
);

const Page: React.FC<{
  content: PageContent;
  showDebugView: boolean;
  fontSize: number;
}> = React.memo(({ content, showDebugView, fontSize }) => {
  return (
    <div className="relative w-full h-full" style={{ height: content.clipHeight ? `${content.clipHeight}px` : '100%', overflow: 'hidden' }}>
        <div style={{ transform: `translateY(-${content.initialYOffset}px)` }}>
            <div
                className="prose prose-invert max-w-none prose-p:text-gray-300 prose-h1:text-cyan-400 prose-h2:text-cyan-300 prose-h3:text-cyan-200 prose-h4:text-gray-200"
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: content.html }}
            />
        </div>
      {showDebugView && (
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
            {content.debugLines.map((line, index) => (
                <div
                key={`debug-line-${index}`}
                className={`absolute ${line.isBad ? 'bg-red-500/30' : 'border border-green-500'}`}
                style={{
                    top: `${line.top}px`,
                    left: `${line.left}px`,
                    width: `${line.width}px`,
                    height: `${line.height}px`,
                }}
                />
            ))}
            </div>
      )}
    </div>
  );
});

export const BookView: React.FC = () => {
  const [blockWidth, setBlockWidth] = useState(500);
  const [blockHeight, setBlockHeight] = useState(440);
  const [fontSize, setFontSize] = useState(19);
  const [showDebugView, setShowDebugView] = useState(true);
  // FIX: Add state for headerMarginTop to satisfy the Controls component's props.
  const [headerMarginTop, setHeaderMarginTop] = useState<number>(1.5);
  // FIX: Add state for debug log
  const [debugLog, setDebugLog] = useState<string | null>(null);

  const [pages, setPages] = useState<PageContent[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const measureRef = useRef<HTMLDivElement>(null);

  const sourceElements = useMemo(() => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${TEXT_CONTENT.trim()}</div>`, "text/html");
    return Array.from(doc.body.firstElementChild!.children) as HTMLElement[];
  }, []);

  // FIX: Add handler for creating debug snapshot
  const handleCreateDebugSnapshot = () => {
    const pageContent = pages[currentPage];
    const measureEl = measureRef.current;
    
    let measureMetrics = 'Measure container not available.';
    if (measureEl) {
        const styles = window.getComputedStyle(measureEl);
        const rect = measureEl.getBoundingClientRect();
        measureMetrics = `
[Measure Container Metrics]
- Client Width: ${measureEl.clientWidth}px
- Client Height: ${measureEl.clientHeight}px
- Scroll Width: ${measureEl.scrollWidth}px
- Scroll Height: ${measureEl.scrollHeight}px
- Bounding Rect: ${rect.width.toFixed(2)}px x ${rect.height.toFixed(2)}px

[Measure Computed Styles]
- width: ${styles.width}
- font-size: ${styles.fontSize}
        `;
    }

    const snapshot = `
========================================
DEBUG SNAPSHOT @ ${new Date().toISOString()}
========================================

[View]
- Type: BookView

[State]
- Block Width: ${blockWidth}px
- Block Height: ${blockHeight}px
- Font Size: ${fontSize}px

[Pagination]
- Total Pages: ${pages.length}
- Current Page Index: ${currentPage}
- Current Spread: ${Math.floor(currentPage / 3) + 1} / ${Math.ceil(pages.length / 3)}

[Current Page Stats]
${pageContent ? `
- Total Lines (Est): ${pageContent.stats.totalLines}
- Good Lines: ${pageContent.stats.goodLines}
- Bad Lines: ${pageContent.stats.badLines}
- Empty Lines: ${pageContent.stats.emptyLines}
- Viewer Height: ${pageContent.stats.viewerHeight.toFixed(0)}px
- Content Height: ${pageContent.stats.contentHeight.toFixed(0)}px
- Initial Y Offset: ${pageContent.initialYOffset}px
- Clip Height: ${pageContent.clipHeight ? pageContent.clipHeight.toFixed(0) + 'px' : 'N/A'}
` : 'No page content available.'}

${measureMetrics}

[Environment]
- User Agent: ${navigator.userAgent}
    `;
    setDebugLog(snapshot.trim());
  };


  useLayoutEffect(() => {
    if (!measureRef.current || sourceElements.length === 0) return;
    
    const pageContentContainer = measureRef.current;
    
    const sampleP = document.createElement('p');
    sampleP.style.visibility = 'hidden';
    sampleP.style.position = 'absolute';
    sampleP.textContent = 'X';
    sampleP.style.fontSize = `${fontSize}px`;
    pageContentContainer.appendChild(sampleP);
    const avgLineHeight = sampleP.offsetHeight > 0 ? sampleP.offsetHeight : fontSize * 1.5;
    pageContentContainer.removeChild(sampleP);
    
    pageContentContainer.innerHTML = '';

    const PADDING_PX_Y = remToPx(PADDING_Y_REM);
    const availableTextHeight = blockHeight - PADDING_PX_Y * 2;
    if (availableTextHeight <= 0) {
      setPages([]);
      return;
    };

    const newPages: PageContent[] = [];
    let elementIndex = 0;
    let yOffsetForNextPage = 0;

    while (elementIndex < sourceElements.length) {
        const initialYOffset = yOffsetForNextPage;
        pageContentContainer.innerHTML = '';
        
        let pageElementsCount = 0;
        let lastMeasuredHeight = 0;

        for (let i = elementIndex; i < sourceElements.length; i++) {
            pageContentContainer.appendChild(sourceElements[i].cloneNode(true));
            lastMeasuredHeight = pageContentContainer.getBoundingClientRect().height;
            pageElementsCount = (i - elementIndex) + 1;
            if ((lastMeasuredHeight - initialYOffset) > availableTextHeight) {
                break;
            }
        }
        
        const fullContentHeightForStats = lastMeasuredHeight;
        const pageElements = sourceElements.slice(elementIndex, elementIndex + pageElementsCount);
        let pageHTML = pageElements.map(e => e.outerHTML).join('');

        let finalPageHTML = pageHTML;
        let finalDebugLines: LineDebugInfo[] = [];
        let finalClipHeight: number | undefined = undefined;
        let displayedContentHeight = fullContentHeightForStats - initialYOffset;
        let yOffsetOnNextPage = 0;
        let advanceBy = pageElementsCount;
        
        const isSplit = (fullContentHeightForStats - initialYOffset) > availableTextHeight + 1;

        if (isSplit) {
            const pageContainerRect = pageContentContainer.getBoundingClientRect();
            const allLines: LineDebugInfo[] = [];
             Array.from(pageContentContainer.children).forEach((el: Element) => {
                const range = document.createRange();
                range.selectNodeContents(el);
                const rects = Array.from(range.getClientRects());
                rects.forEach(lineRect => {
                    const lineTopInPage = (lineRect.top - pageContainerRect.top) - initialYOffset;
                     if (lineRect.width < 1 || lineRect.height < 1) return;
                    allLines.push({
                        top: lineTopInPage, left: lineRect.left - pageContainerRect.left,
                        width: lineRect.width, height: lineRect.height, isBad: false, // will determine badness later
                    });
                });
            });

            const goodLines = allLines.filter(l => (l.top + l.height) <= availableTextHeight + 1);

            if (goodLines.length > 0) {
                const lastGoodLine = goodLines[goodLines.length - 1];
                finalClipHeight = lastGoodLine.top + lastGoodLine.height;
                displayedContentHeight = finalClipHeight;
                finalDebugLines = goodLines;
                yOffsetOnNextPage = initialYOffset + finalClipHeight;
                
                const lastElementOnPage = pageElements[pageElements.length - 1];
                 const canSplitLastElement = lastElementOnPage && !lastElementOnPage.tagName.startsWith('H');
                
                if(canSplitLastElement){
                    advanceBy -= 1; 
                } else {
                    finalPageHTML = pageElements.slice(0, -1).map(e => e.outerHTML).join('');
                    yOffsetOnNextPage = 0;
                }
            } else {
                 finalPageHTML = '';
                 finalDebugLines = [];
                 displayedContentHeight = 0;
                 yOffsetOnNextPage = 0; 
                 advanceBy = Math.max(0, pageElementsCount - 1);
            }
        } else {
            const pageContainerRect = pageContentContainer.getBoundingClientRect();
             Array.from(pageContentContainer.children).forEach((el: Element) => {
                const range = document.createRange();
                range.selectNodeContents(el);
                const rects = Array.from(range.getClientRects());
                rects.forEach(lineRect => {
                    finalDebugLines.push({
                        top: (lineRect.top - pageContainerRect.top) - initialYOffset,
                        left: lineRect.left - pageContainerRect.left,
                        width: lineRect.width, height: lineRect.height, isBad: false
                    });
                });
            });
        }
        
        const goodLinesCount = finalDebugLines.length;
        const totalLinesCount = Math.max(0, Math.floor(availableTextHeight / avgLineHeight));

        if(finalPageHTML.trim() !== '' || newPages.length === 0) {
             newPages.push({
                html: finalPageHTML,
                initialYOffset: initialYOffset,
                debugLines: finalDebugLines,
                clipHeight: finalClipHeight,
                stats: {
                    totalLines: totalLinesCount,
                    goodLines: goodLinesCount, badLines: 0, // Bad lines are no longer rendered
                    emptyLines: Math.max(0, totalLinesCount - goodLinesCount),
                    viewerHeight: availableTextHeight,
                    contentHeight: fullContentHeightForStats,
                }
            });
        }
        
        yOffsetForNextPage = yOffsetOnNextPage;
        elementIndex += advanceBy;
         if (elementIndex === sourceElements.length && yOffsetForNextPage > 0) {
            // Handle dangling yOffset from a split on the very last element
            elementIndex--;
        }

        if (advanceBy === 0 && isSplit) {
            elementIndex++;
        }
    }

    setPages(newPages);
    if (currentPage >= newPages.length) {
      setCurrentPage(Math.max(0, newPages.length > 0 ? newPages.length - (newPages.length % 3 || 3) : 0));
    }
  }, [blockWidth, blockHeight, fontSize, sourceElements, currentPage]); // Added currentPage to deps to re-evaluate if needed

  const handleTurnPage = (direction: 'next' | 'prev') => {
    setCurrentPage(p => direction === 'next' ? Math.min(p + 3, pages.length - (pages.length % 3 || 3)) : Math.max(0, p - 3));
  };
  
  const totalSpreads = Math.ceil(pages.length / 3);
  const currentSpread = Math.floor(currentPage / 3) + 1;

  const renderPage = (pageIndex: number) => {
    const pageContent = pages[pageIndex];
    return (
        <div className="flex flex-col gap-4" style={{ width: blockWidth }}>
             {showDebugView && pageContent ? <PageStats stats={pageContent.stats} /> : <div className="h-[70px]" />}
            <div className="w-full bg-gray-800 shadow-lg rounded-lg border border-gray-700 overflow-hidden" style={{height: blockHeight}}>
              <div className="relative w-full h-full" style={{padding: `${remToPx(PADDING_Y_REM)}px ${remToPx(PADDING_X_REM)}px`}}>
                {pageContent ? <Page content={pageContent} showDebugView={showDebugView} fontSize={fontSize} /> : (
                     <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-24 h-24 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                     </div>
                )}
              </div>
            </div>
        </div>
    );
  }

  return (
    <>
      <main className="flex-grow flex flex-col lg:flex-row p-4 sm:p-6 lg:p-8 gap-8">
        <aside className="w-full lg:w-72 lg:flex-shrink-0">
          <Controls
            width={blockWidth} setWidth={setBlockWidth} height={blockHeight} setHeight={setBlockHeight}
            fontSize={fontSize} setFontSize={setFontSize} showDebugView={showDebugView} setShowDebugView={setShowDebugView}
            headerMarginTop={headerMarginTop}
            setHeaderMarginTop={setHeaderMarginTop}
            // FIX: Pass required onCreateDebugSnapshot prop
            onCreateDebugSnapshot={handleCreateDebugSnapshot}
          />
        </aside>
        <div className="flex-grow flex flex-col items-center justify-center relative">
          <div className="relative transition-all duration-200 flex justify-center items-start gap-8" style={{ width: `${blockWidth * 3 + 64}px` }}>
            {renderPage(currentPage)} {renderPage(currentPage + 1)} {renderPage(currentPage + 2)}
          </div>
          <div className="flex items-center justify-center mt-6 w-full max-w-md">
            <button onClick={() => handleTurnPage('prev')} disabled={currentPage === 0} className="p-2 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white disabled:text-gray-600 disabled:bg-transparent transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="font-mono text-center text-sm text-gray-500 w-28">Spread {currentSpread} / {totalSpreads}</span>
            <button onClick={() => handleTurnPage('next')} disabled={currentPage + 3 >= pages.length} className="p-2 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white disabled:text-gray-600 disabled:bg-transparent transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <div style={{ position: 'absolute', top: 0, left: 0, visibility: 'hidden', zIndex: -1, pointerEvents: 'none' }}>
            <div ref={measureRef} className="prose prose-invert" style={{ width: `${blockWidth > 0 ? blockWidth - remToPx(PADDING_X_REM) * 2 : 0}px`, fontSize: `${fontSize}px` }}/>
          </div>
        </div>
      </main>
      {debugLog && <DebugModal log={debugLog} onClose={() => setDebugLog(null)} />}
    </>
  );
};
