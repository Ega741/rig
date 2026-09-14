import { useEffect, useMemo, useState } from 'react';
import { loadConfig, type UiConfig } from './config';
import { shortAddress } from './format';
import { Docs } from './pages/Docs';
import { Mine } from './pages/Mine';
import { Stats } from './pages/Stats';
import { Token } from './pages/Token';

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

/** 12x8 pixel graphics card: bracket, board, two fans. */
function CardIcon() {
  const px = (x: number, y: number, w = 1, h = 1, fill = 'var(--lime)') => (
    <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  );
  return (
    <svg viewBox="0 0 12 8" aria-hidden="true" shapeRendering="crispEdges">
      {px(0, 0, 2, 8, 'var(--ink-2)')}
      {px(2, 1, 10, 6)}
      {px(3, 2, 3, 4, 'var(--bg)')}
      {px(7, 2, 3, 4, 'var(--bg)')}
      {px(4, 3, 1, 2)}
      {px(8, 3, 1, 2)}
      {px(2, 7, 10, 1, 'var(--green)')}
    </svg>
  );
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
        <a className="brand" href="#/mine">
          <CardIcon />
          <span>
            <b>Rig</b>
          </span>
        </a>
        <nav className="nav" aria-label="Pages">
          <a href="#/mine" aria-current={route === 'mine' ? 'page' : undefined}>
            Mine
          </a>
          <a href="#/token" aria-current={route === 'token' ? 'page' : undefined}>
            Token
          </a>
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
          <a href="#/token">Token</a>
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
          <div className="muted">{config.chain.name}</div>
        </div>
      </footer>
    </>
  );
}
