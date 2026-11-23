import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { bootstrapRuntimeConfig } from './lib/bootstrap';
import { installPreloadErrorRecovery } from './lib/preloadRecovery';

// Typography Font Bundles (Eye-Comfort & Institutional Finance Ledger)
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

installPreloadErrorRecovery({
  addEventListener: (type, listener) => {
    window.addEventListener(type, listener as EventListener);
  },
  sessionStorage: getSessionStorage(),
  reload: () => window.location.reload(),
  reportError: (event) => {
    console.error('[Vite] Dynamic chunk still failing after recovery reload:', event);
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

void bootstrapRuntimeConfig().finally(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
