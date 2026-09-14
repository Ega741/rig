import { useEffect, useMemo, useState } from 'react';
import { loadConfig, type UiConfig } from './config';
import { shortAddress } from './format';
import { Docs } from './pages/Docs';
import { Mine } from './pages/Mine';
import { Stats } from './pages/Stats';
import { Token } from './pages/Token';
import { Wordmark } from './Wordmark';

type Route = 'mine' | 'token' | 'stats' | 'docs';

function routeFromHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return name === 'stats' || name === 'docs' || name === 'token' ? name : 'mine';
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
        <h1>Rig is not configured</h1>
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
        <a className="brand" href="#/mine" aria-label="Rig">
          <Wordmark height={26} />
        </a>
        <nav className="nav" aria-label="Pages">
          <a href="#/mine" aria-current={route === 'mine' ? 'page' : undefined}>
            Mine
          </a>
          {config.ponsToken && (
            <a href="#/token" aria-current={route === 'token' ? 'page' : undefined}>
              Token
            </a>
          )}
          <a href="#/stats" aria-current={route === 'stats' ? 'page' : undefined}>
            Stats
          </a>
          <a href="#/docs" aria-current={route === 'docs' ? 'page' : undefined}>
            Docs
          </a>
        </nav>
      </header>
      <div className="divider" />
      <main className="page">
        {route === 'mine' && <Mine config={config} />}
        {route === 'token' && <Token config={config} />}
        {route === 'stats' && <Stats config={config} />}
        {route === 'docs' && <Docs config={config} />}
      </main>
      <div className="divider" />
      <footer className="footer">
        <div>
          <div className="label">Rig</div>
          <p>
            A token you mine in the browser. Trading fees buy it back into the pool; every round splits the release by work. No mint, no
            reserve, no team share.
          </p>
        </div>
        <div>
          <div className="label">Pages</div>
          <a href="#/mine">Mine</a>
          {config.ponsToken && <a href="#/token">Token</a>}
          <a href="#/stats">Stats</a>
          <a href="#/docs">Docs</a>
        </div>
        <div>
          <div className="label">Contracts</div>
          <div className="mono" title={config.hashMine}>
            HashMine {shortAddress(config.hashMine)}
          </div>
          {config.treasury && (
            <div className="mono" title={config.treasury}>
              Treasury {shortAddress(config.treasury)}
            </div>
          )}
          <div className="muted">Robinhood Chain Mainnet</div>
        </div>
        <div>
          <div className="label">Elsewhere</div>
          {config.xUrl ? (
            <a href={config.xUrl} target="_blank" rel="noreferrer">
              X
            </a>
          ) : (
            <span className="muted">X · soon</span>
          )}
          <a href="https://github.com/Ega741/rig" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
