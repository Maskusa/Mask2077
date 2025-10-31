import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { Controls } from './components/Controls';
import { TEXT_CONTENT } from './constants';
import { DebugModal } from './components/DebugModal';

const App: React.FC = () => {
  const [blockWidth, setBlockWidth] = useState<number>(600);
  const [blockHeight, setBlockHeight] = useState<number>(800);
  const [fontSize, setFontSize] = useState<number>(16);
  const [headerMarginTop, setHeaderMarginTop] = useState<number>(1.5); // Base margin in rem
  const [showDebugView, setShowDebugView] = useState<boolean>(false);
  const [debugLog, setDebugLog] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pageShiftWidth, setPageShiftWidth] = useState(0);

  // State to hold the browser's computed root font size.
  const [remInPx, setRemInPx] = useState(16); // Default to 16, update on mount.

  const textContainerRef = useRef<HTMLDivElement>(null);

  const columnGap = 32;
  const PADDING_REM = 1.5; // p-6 is 1.5rem
  const BORDER_WIDTH_PX = 1; // border is 1px

  // This effect runs once on mount to get the actual root font size.
  useLayoutEffect(() => {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    setRemInPx(rootFontSize);
    console.log(`[DEBUG] Root font size detected: ${rootFontSize}px`);
  }, []);

  useEffect(() => {
    // This effect runs after every render and logs the current state that was used for rendering.
    console.log(`[DEBUG] Render State:`, {
        currentPage: currentPage + 1,
        totalPages,
        pageShiftWidth: pageShiftWidth ? `${pageShiftWidth.toFixed(4)}px` : 'N/A',
        appliedTransform: `translateX(-${(currentPage * pageShiftWidth).toFixed(4)}px)`,
    });
  });

  useLayoutEffect(() => {
    const el = textContainerRef.current;
    if (!el) return;

    // --- NEW PRECISION LOGIC ---
    const paddingInPx = PADDING_REM * remInPx;
    const totalBorderWidth = BORDER_WIDTH_PX * 2;
    
    const preciseColumnWidth = blockWidth - (paddingInPx * 2) - totalBorderWidth;
    
    const calculatedPageShiftWidth = preciseColumnWidth + columnGap;
    setPageShiftWidth(calculatedPageShiftWidth);

    const totalContentWidth = el.scrollWidth;

    // FIX: Subtract a small epsilon to counteract browser scrollWidth rounding errors
    // that might push the page count up by one, creating a ghost page.
    const rawPageCount = (totalContentWidth + columnGap) / calculatedPageShiftWidth;
    const numPages = totalContentWidth > 0 && calculatedPageShiftWidth > 0 
      ? Math.ceil(rawPageCount - 0.001)
      : 1;
      
    const totalChars = TEXT_CONTENT.trim().length;
    const estimatedCharsPerPage = numPages > 0 ? Math.round(totalChars / numPages) : 0;

    console.log(`[DEBUG] useLayoutEffect: Recalculating pagination...`, {
        dependencies: { blockWidth, blockHeight, fontSize, remInPx },
        measurements: {
            totalContentWidth: `${totalContentWidth}px`,
        },
        calculations: {
            rawPageCount: rawPageCount,
            paddingInPx: `${paddingInPx.toFixed(4)}px`,
            preciseColumnWidth: `${preciseColumnWidth.toFixed(4)}px`,
            calculatedPageShiftWidth: `${calculatedPageShiftWidth.toFixed(4)}px`,
            numPages: numPages,
            totalChars: totalChars,
            estimatedCharsPerPage: estimatedCharsPerPage,
        }
    });
    
    setTotalPages(numPages);

    if (currentPage >= numPages) {
      const adjustedPage = Math.max(0, numPages - 1);
      console.log(`[DEBUG] useLayoutEffect: Adjusting current page from ${currentPage + 1} to ${adjustedPage + 1}`);
      setCurrentPage(adjustedPage);
    }
  }, [blockWidth, blockHeight, fontSize, remInPx]);


  const handleCreateDebugSnapshot = () => {
    if (!textContainerRef.current) {
      setDebugLog("Error: Could not find text container element to create a snapshot.");
      return;
    }

    const el = textContainerRef.current;
    const styles = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const snapshot = `
========================================
DEBUG SNAPSHOT @ ${new Date().toISOString()}
========================================

[State]
- Column Width: ${blockWidth}px
- Column Height: ${blockHeight}px
- Font Size: ${fontSize}px
- Header Margin: ${headerMarginTop}rem
- Current Page: ${currentPage + 1}
- Total Pages: ${totalPages}
- Page Shift Width: ${pageShiftWidth.toFixed(2)}px
- 1rem = ${remInPx}px

[Container Metrics]
- Client Width (1 column): ${el.clientWidth}px
- Client Height: ${el.clientHeight}px
- Scroll Width (all columns): ${el.scrollWidth}px
- Scroll Height: ${el.scrollHeight}px
- Bounding Rect: ${rect.width.toFixed(2)}px x ${rect.height.toFixed(2)}px

[Computed Styles]
- column-width: ${styles.columnWidth}
- column-gap: ${styles.columnGap}
- transform: ${el.style.transform}
- height: ${styles.height}
- font-size: ${styles.fontSize}

[Environment]
- User Agent: ${navigator.userAgent}
    `;
    setDebugLog(snapshot.trim());
  };

  const handlePrevPage = () => {
      console.log(`[DEBUG] handlePrevPage START: About to update state.`);
      setCurrentPage(p => {
        const oldPage = p;
        const newPage = Math.max(0, oldPage - 1);
        
        console.log(`[DEBUG] handlePrevPage UPDATE:`, {
          fromPage: oldPage + 1,
          toPage: newPage + 1,
          totalPages,
          pageShiftWidth: `${pageShiftWidth.toFixed(4)}px`,
          newTransform: `translateX(-${(newPage * pageShiftWidth).toFixed(4)}px)`,
        });

        return newPage;
      });
  };

  const handleNextPage = () => {
      console.log(`[DEBUG] handleNextPage START: About to update state.`);
      setCurrentPage(p => {
        const oldPage = p;
        const newPage = Math.min(totalPages - 1, oldPage + 1);

        console.log(`[DEBUG] handleNextPage UPDATE:`, {
          fromPage: oldPage + 1,
          toPage: newPage + 1,
          totalPages,
          pageShiftWidth: `${pageShiftWidth.toFixed(4)}px`,
          newTransform: `translateX(-${(newPage * pageShiftWidth).toFixed(4)}px)`,
        });
        
        return newPage;
      });
  };

  const dynamicHeaderStyles = `
    /*
      This block takes full control over vertical margins for headers and paragraphs
      to provide predictable spacing and prevent CSS margin collapse issues.
      Using a more specific selector (.prose.dynamic-header-margins) to ensure
      these styles override Tailwind's defaults.
    */

    /* 1. Neutralize default prose margins. */
    .prose.dynamic-header-margins h1,
    .prose.dynamic-header-margins h2,
    .prose.dynamic-header-margins h3,
    .prose.dynamic-header-margins h4,
    .prose.dynamic-header-margins p {
      margin-top: 0;
      margin-bottom: 0;
    }

    /* 2. Apply dynamic margins, controlled by the "Header Margin" slider. */
    
    /* Space ABOVE a header (applied to the header itself) */
    .prose.dynamic-header-margins > * + h1 { margin-top: ${headerMarginTop * 1.66}rem; }
    .prose.dynamic-header-margins > * + h2 { margin-top: ${headerMarginTop * 1.33}rem; }
    .prose.dynamic-header-margins > * + h3 { margin-top: ${headerMarginTop}rem; }
    .prose.dynamic-header-margins > * + h4 { margin-top: ${headerMarginTop}rem; }

    /* Space BELOW a header (applied as a top margin to the following element, as requested) */
    .prose.dynamic-header-margins h1 + *,
    .prose.dynamic-header-margins h2 + *,
    .prose.dynamic-header-margins h3 + *,
    .prose.dynamic-header-margins h4 + * {
        margin-top: ${headerMarginTop * 0.75}rem;
    }

    /* 3. Re-apply a standard margin between consecutive paragraphs. */
    .prose.dynamic-header-margins p + p {
      margin-top: 1.25em;
    }

    /* 4. Reset margin for the very first element in the content. */
    .prose.dynamic-header-margins > :first-child { margin-top: 0 !important; }
  `;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col font-sans">
      <style>{dynamicHeaderStyles}</style>
      <header className="p-4 bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-center text-cyan-400 tracking-wider">
          Flowing Text Layout Engine
        </h1>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row p-4 sm:p-6 lg:p-8 gap-8">
        <aside className="w-full lg:w-72 lg:flex-shrink-0">
           <Controls
            width={blockWidth}
            setWidth={setBlockWidth}
            height={blockHeight}
            setHeight={setBlockHeight}
            fontSize={fontSize}
            setFontSize={setFontSize}
            headerMarginTop={headerMarginTop}
            setHeaderMarginTop={setHeaderMarginTop}
            showDebugView={showDebugView}
            setShowDebugView={setShowDebugView}
            onCreateDebugSnapshot={handleCreateDebugSnapshot}
          />
        </aside>
        
        <div className="flex-grow flex flex-col items-center justify-center gap-4">
            {/* Viewport for a single page */}
            <div
                className="relative transition-all duration-200 border border-gray-700 rounded-lg bg-gray-900/10 shadow-lg p-6"
                style={{
                    width: `${blockWidth}px`,
                    height: `${blockHeight}px`,
                    overflow: 'hidden',
                }}
            >
                {/* Sliding container with all the content laid out in columns */}
                <div
                    ref={textContainerRef}
                    className="text-justify leading-relaxed transition-transform duration-500 ease-in-out"
                    style={{
                        height: `${blockHeight - (PADDING_REM * 2 * remInPx) - (BORDER_WIDTH_PX * 2)}px`,
                        fontSize: `${fontSize}px`,
                        columnWidth: `${blockWidth - (PADDING_REM * 2 * remInPx) - (BORDER_WIDTH_PX * 2)}px`,
                        columnGap: `${columnGap}px`,
                        columnFill: 'auto',
                        transform: `translateX(-${currentPage * pageShiftWidth}px)`,
                    }}
                >
                    <div 
                      className="prose prose-invert max-w-none prose-p:text-gray-300 prose-h1:text-cyan-400 prose-h2:text-cyan-300 prose-h3:text-cyan-200 prose-h4:text-gray-200 [&>*]:[break-inside:auto] [&>*]:orphans-1 [&>*]:widows-1 dynamic-header-margins"
                      dangerouslySetInnerHTML={{ __html: TEXT_CONTENT.trim() }} 
                    />
                </div>
                 {/* Visual logging overlay */}
                {showDebugView && (
                    <div className="absolute top-2 right-2 bg-gray-900/70 backdrop-blur-sm border border-cyan-700 text-cyan-400 font-mono text-xs p-2 rounded-md pointer-events-none">
                        <div>Width: {blockWidth}px</div>
                        <div>Height: {blockHeight}px</div>
                        <div>Font: {fontSize}px</div>
                        <div>Page: {currentPage + 1}/{totalPages}</div>
                    </div>
                )}
            </div>

             {/* Navigation Controls */}
            <div className="flex items-center justify-center gap-4 text-gray-400 font-mono mt-2">
                <button onClick={handlePrevPage} disabled={currentPage === 0} className="px-4 py-2 rounded-md bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    Previous
                </button>
                <span className="text-sm w-24 text-center">
                    Page {currentPage + 1} / {totalPages}
                </span>
                <button onClick={handleNextPage} disabled={currentPage >= totalPages - 1} className="px-4 py-2 rounded-md bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    Next
                </button>
            </div>
        </div>
      </main>
      {debugLog && <DebugModal log={debugLog} onClose={() => setDebugLog(null)} />}
    </div>
  );
};

export default App;