import React from 'react';
import type { LogEntry } from '../context/LogContext';

interface LogOverlayProps {
  visible: boolean;
  logs: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}

const LogOverlay: React.FC<LogOverlayProps> = ({ visible, logs, onClose, onClear }) => {
  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-start justify-center p-4">
      <div className="w-full max-w-3xl bg-gray-900 bg-opacity-95 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-200">Log Output</h2>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded-md bg-yellow-500 hover:bg-yellow-400 text-black font-semibold transition-colors"
              onClick={onClear}
              type="button"
            >
              Clear
            </button>
            <button
              className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-4 space-y-1 text-sm font-mono text-gray-200">
          {logs.length === 0 ? (
            <p className="text-gray-500">Log is empty.</p>
          ) : (
            logs.map((entry, idx) => (
              <div key={entry.id} className="flex gap-4">
                <span className="text-gray-500 w-10 text-right">{idx + 1}</span>
                <span className="flex-1 break-words">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default LogOverlay;
