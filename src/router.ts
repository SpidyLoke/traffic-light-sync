import { useEffect, useState } from 'react';

// Hash routing: works on any static host with no rewrite rules.
export type Route =
  | { name: 'predict' }
  | { name: 'capture' }
  | { name: 'lights' }
  | { name: 'light'; id: string }
  | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'capture':
      return { name: 'capture' };
    case 'lights':
      return { name: 'lights' };
    case 'light':
      return parts[1] ? { name: 'light', id: decodeURIComponent(parts[1]) } : { name: 'lights' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'predict' };
  }
}

export function href(r: Route): string {
  return r.name === 'light' ? `#/light/${encodeURIComponent(r.id)}` : `#/${r.name}`;
}

export function navigate(r: Route) {
  window.location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
