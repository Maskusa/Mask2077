
import React, { useState, useRef } from 'react';
import { Controls } from '../components/Controls';
import { TEXT_CONTENT } from '../constants';
import { DebugModal } from '../components/DebugModal';

export const ColumnsView: React.FC = () => {
  const [blockWidth, setBlockWidth] = useState<number>(300);
  const [blockHeight, setBlockHeight] = useState<number>(400);
  const [fontSize, setFontSize] = useState<number>(16);
  // FIX: Add state for headerMarginTop to satisfy the Controls component's props.
  const [headerMarginTop, setHeaderMarginTop] = useState<number>(1.5);
  // FIX: Add state for debug view and debug log
  const [showDebugView, setShowDebugView] = useState<boolean>(false);
  const [debugLog, setDebugLog] = useState<string | null>(null);

  const textContainerRef = useRef<HTMLDivElement>(null);

  const columnGap = 32; // 2rem in pixels (1rem = 16px)

  // FIX: Add handler for creating debug snapshot
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

[View]
- Type: ColumnsView

[State]
- Column Width: ${blockWidth}px
- Column Height: ${blockHeight}px
- Font Size: ${fontSize}px

[Container Metrics]
- Client Width: ${el.clientWidth}px
- Client Height: ${el.clientHeight}px
- Scroll Width: ${el.scrollWidth}px
- Scroll Height: ${el.scrollHeight}px
- Bounding Rect: ${rect.width.toFixed(2)}px x ${rect.height.toFixed(2)}px

[Computed Styles]
- columns: ${styles.columns}
- column-gap: ${styles.columnGap}
- column-rule: ${styles.columnRule}
- height: ${styles.height}
- font-size: ${styles.fontSize}

[Environment]
- User Agent: ${navigator.userAgent}
    `;
    setDebugLog(snapshot.trim());
  };


  return (
    <>
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
            // FIX: Pass required props for debug functionality
            showDebugView={showDebugView}
            setShowDebugView={setShowDebugView}
            onCreateDebugSnapshot={handleCreateDebugSnapshot}
          />
        </aside>
        
        <div className="flex-grow flex items-center justify-center overflow-x-auto">
            <div
                className="p-1"
                style={{
                    width: `${(4 * blockWidth) + (3 * columnGap)}px`,
                }}
            >
                <div
                    ref={textContainerRef}
                    className="text-justify leading-relaxed transition-all duration-200"
                    style={{
                        height: `${blockHeight}px`,
                        fontSize: `${fontSize}px`,
                        columns: `${blockWidth}px 4`,
                        columnGap: `${columnGap}px`,
                        columnRule: showDebugView ? `1px solid #4A5568` : 'none', // gray-700
                    }}
                >
                    <div 
                      className="prose prose-invert max-w-none prose-p:text-gray-300 prose-h1:text-cyan-400 prose-h2:text-cyan-300 prose-h3:text-cyan-200 prose-h4:text-gray-200"
                      dangerouslySetInnerHTML={{ __html: TEXT_CONTENT.replace(/\n/g, '<br/><br/>') }} 
                    />
                </div>
            </div>
        </div>
      </main>
      {debugLog && <DebugModal log={debugLog} onClose={() => setDebugLog(null)} />}
    </>
  );
};
