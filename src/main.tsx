import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Clear any legacy v3 caches and update service workers so mobile browsers never stay stuck on old UI.
if (typeof window !== 'undefined') {
  if ('caches' in window) {
    caches.keys().then((keys) => {
      for (const key of keys) {
        if (key.startsWith('hb-pos-cache-')) {
          caches.delete(key).catch(() => {});
        }
      }
    }).catch(() => {});
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.update().catch(() => {});
      }
    }).catch(() => {});
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
