import React from 'react';

interface ControlsProps {
  width: number;
  setWidth: (value: number) => void;
  height: number;
  setHeight: (value: number) => void;
  fontSize: number;
  setFontSize: (value: number) => void;
  headerMarginTop: number;
  setHeaderMarginTop: (value: number) => void;
  showDebugView?: boolean;
  setShowDebugView?: (value: boolean) => void;
  onCreateDebugSnapshot: () => void;
}

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ label, value, min, max, step, unit, onChange }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-baseline">
      <label className="text-sm font-medium text-gray-400">{label}</label>
      <span className="text-cyan-400 font-mono bg-gray-700/50 px-2 py-1 rounded text-sm">
        {value.toFixed(1)}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
    />
  </div>
);

export const Controls: React.FC<ControlsProps> = ({
  width,
  setWidth,
  height,
  setHeight,
  fontSize,
  setFontSize,
  headerMarginTop,
  setHeaderMarginTop,
  showDebugView,
  setShowDebugView,
  onCreateDebugSnapshot
}) => {
  return (
    <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 space-y-6 sticky top-24">
      <h2 className="text-lg font-semibold text-white border-b border-gray-600 pb-3 mb-4">
        Layout Controls
      </h2>
      <Slider
        label="Column Width"
        value={width}
        min={150}
        max={600}
        step={1}
        unit="px"
        onChange={(e) => setWidth(Number(e.target.value))}
      />
      <Slider
        label="Column Height"
        value={height}
        min={200}
        max={800}
        step={1}
        unit="px"
        onChange={(e) => setHeight(Number(e.target.value))}
      />
      <Slider
        label="Font Size"
        value={fontSize}
        min={8}
        max={32}
        step={1}
        unit="px"
        onChange={(e) => setFontSize(Number(e.target.value))}
      />
      <Slider
        label="Header Margin"
        value={headerMarginTop}
        min={0}
        max={8}
        step={0.1}
        unit="rem"
        onChange={(e) => setHeaderMarginTop(Number(e.target.value))}
      />

      <div className="pt-4 border-t border-gray-600 space-y-4">
        {showDebugView !== undefined && setShowDebugView && (
            <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-400">
                Show Debug View
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={showDebugView}
                onClick={() => setShowDebugView(!showDebugView)}
                className={`${
                showDebugView ? 'bg-cyan-500' : 'bg-gray-600'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-gray-800`}
            >
                <span
                aria-hidden="true"
                className={`${
                    showDebugView ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
            </button>
            </div>
        )}
        <button
            onClick={onCreateDebugSnapshot}
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        >
            Create Debug Snapshot
        </button>
      </div>
    </div>
  );
};