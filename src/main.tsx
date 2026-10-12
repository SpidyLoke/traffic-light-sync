import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { DataProvider } from './state/DataContext';
import { GeoProvider } from './state/GeoContext';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <GeoProvider>
        <App />
      </GeoProvider>
    </DataProvider>
  </StrictMode>,
);
