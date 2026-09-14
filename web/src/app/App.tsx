import { useEffect, useMemo, useState } from 'react';
import { loadConfig, type UiConfig } from './config';
import { shortAddress } from './format';
import { Docs } from './pages/Docs';
import { Mine } from './pages/Mine';
import { Stats } from './pages/Stats';

type Route = 'mine' | 'stats' | 'docs';

function routeFromHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return name === 'stats' || name === 'docs' ? name : 'mine';
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const config = useMemo<UiConfig | Error>(() => {
    try {
      return loadConfig(import.meta.env as Record<string, string | undefined>, window.location.search);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, []);

  if (config instanceof Error) {
    return (
      <main className="page prose">
        <h1>hashmine is not configured</h1>
        <p className="error">{config.message}</p>
        <p>
          Set <code>VITE_CHAIN</code>, <code>VITE_HASHMINE_ADDRESS</code> and optionally <code>VITE_RPC_URL</code> at build time, or pass{' '}
          <code>?chain=local&amp;rpc=…&amp;hashMine=0x…</code> in the URL.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="top">
        <a className="brand" href="#/mine">
          hashmine
        </a>
        <nav className="nav" aria-label="Pages">
          <a href="#/mine" aria-current={route === 'mine' ? 'page' : undefined}>
            Mine
          </a>
          <a href="#/stats" aria-current={route === 'stats' ? 'page' : undefined}>
            Stats
          </a>
          <a href="#/docs" aria-current={route === 'docs' ? 'page' : undefined}>
            Docs
          </a>
        </nav>
        <span className="net" title={config.hashMine}>
          {config.chain.name} · {shortAddress(config.hashMine)}
        </span>
      </header>
      <main className="page">
        {route === 'mine' && <Mine config={config} />}
        {route === 'stats' && <Stats config={config} />}
        {route === 'docs' && <Docs config={config} />}
      </main>
    </>
  );
}
