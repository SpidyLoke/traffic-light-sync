import { createContext, useContext, useEffect, useState } from 'react';
import type { DirOverride } from './lib/locate';
import { href, useRoute, type Route } from './router';
import { CaptureScreen } from './screens/CaptureScreen';
import { LightDebugScreen } from './screens/LightDebugScreen';
import { LightsScreen } from './screens/LightsScreen';
import { PredictScreen } from './screens/PredictScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useData } from './state/DataContext';

interface Ui {
  dirOverride: DirOverride;
  setDirOverride(d: DirOverride): void;
}
const UiCtx = createContext<Ui>({ dirOverride: 'auto', setDirOverride: () => {} });
export const useUi = () => useContext(UiCtx);

const TABS: { route: Route; label: string; icon: string }[] = [
  { route: { name: 'predict' }, label: 'Predict', icon: '◉' },
  { route: { name: 'capture' }, label: 'Capture', icon: '✚' },
  { route: { name: 'lights' }, label: 'Lights', icon: '⋮' },
  { route: { name: 'settings' }, label: 'More', icon: '≡' },
];

export default function App() {
  const route = useRoute();
  const { ready, settings } = useData();
  const [dirOverride, setDirOverride] = useState<DirOverride>('auto');
  const routeKey = route.name === 'light' ? `light/${route.id}` : route.name;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [routeKey]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'light' ? '#ffffff' : '#000000');
  }, [settings.theme]);

  if (!ready) return <div className="p-6 text-xl">Loading…</div>;

  const active = route.name === 'light' ? 'lights' : route.name;
  return (
    <UiCtx.Provider value={{ dirOverride, setDirOverride }}>
      <main className="min-h-full">
        {route.name === 'predict' && <PredictScreen />}
        {route.name === 'capture' && <CaptureScreen />}
        {route.name === 'lights' && <LightsScreen />}
        {route.name === 'light' && <LightDebugScreen id={route.id} />}
        {route.name === 'settings' && <SettingsScreen />}
      </main>
      <nav className="material-bar fixed inset-x-0 bottom-0 z-20 safe-bottom">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map((t) => {
            const on = t.route.name === active;
            return (
              <a
                key={t.label}
                href={href(t.route)}
                className={`press flex flex-col items-center py-2.5 text-sm font-bold ${on ? 'text-accent' : 'text-muted'}`}
              >
                <span className="text-xl leading-none" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </a>
            );
          })}
        </div>
      </nav>
    </UiCtx.Provider>
  );
}
