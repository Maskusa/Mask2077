import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export interface LogEntry {
  id: number;
  message: string;
  timestamp: number;
}

interface LogContextValue {
  logs: LogEntry[];
  addLog: (message: string) => void;
  clearLogs: () => void;
}

const LogContext = createContext<LogContextValue | undefined>(undefined);

export const LogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const addLog = useCallback((message: string) => {
    console.log('[AppLog]', message);
    setLogs((prev) => {
      const entry: LogEntry = {
        id: prev.length > 0 ? prev[prev.length - 1].id + 1 : 1,
        message,
        timestamp: Date.now(),
      };
      const next = prev.length >= 500 ? [...prev.slice(1), entry] : [...prev, entry];
      return next;
    });
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const value = useMemo<LogContextValue>(() => ({ logs, addLog, clearLogs }), [logs, addLog, clearLogs]);

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
};

export const useLogContext = (): LogContextValue => {
  const ctx = useContext(LogContext);
  if (!ctx) {
    throw new Error('useLogContext must be used within LogProvider');
  }
  return ctx;
};
