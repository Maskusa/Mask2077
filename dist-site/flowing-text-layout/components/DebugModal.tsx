import React, { useRef, useEffect, useState } from 'react';

interface DebugModalProps {
  log: string;
  onClose: () => void;
}

export const DebugModal: React.FC<DebugModalProps> = ({ log, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copyButtonText, setCopyButtonText] = useState('Copy to Clipboard');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      // Show the modal when the component mounts with a log
      if (!dialog.open) {
        dialog.showModal();
      }
      // Handle closing via the Escape key
      const handleCancel = (event: Event) => {
        event.preventDefault();
        onClose();
      };
      dialog.addEventListener('cancel', handleCancel);
      return () => dialog.removeEventListener('cancel', handleCancel);
    }
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(log).then(() => {
      setCopyButtonText('Copied!');
      setTimeout(() => setCopyButtonText('Copy to Clipboard'), 2000);
    }).catch(err => {
      console.error('Failed to copy log:', err);
      setCopyButtonText('Error!');
      setTimeout(() => setCopyButtonText('Copy to Clipboard'), 2000);
    });
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="bg-gray-800 text-gray-200 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl p-0 backdrop:bg-black/60"
    >
      <div className="p-6">
        <h2 className="text-xl font-bold text-cyan-400 mb-4">Debug Snapshot</h2>
        <div className="bg-gray-900 rounded-lg p-4 max-h-[60vh] overflow-auto">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            <code>{log}</code>
          </pre>
        </div>
      </div>
      <footer className="px-6 py-4 bg-gray-900/50 border-t border-gray-700 flex justify-end items-center gap-4 rounded-b-xl">
        <button
          onClick={handleCopy}
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-md transition-colors duration-200 text-sm"
        >
          {copyButtonText}
        </button>
        <button
          onClick={onClose}
          className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 text-sm"
        >
          Close
        </button>
      </footer>
    </dialog>
  );
};