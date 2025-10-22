
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LogProvider } from './context/LogContext';
import { initAnalytics } from './firebase';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

void initAnalytics();

root.render(
  <React.StrictMode>
    <LogProvider>
      <App />
    </LogProvider>
  </React.StrictMode>
);
