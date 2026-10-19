import { useEffect, useState } from 'react';
import AnalyzePage from './components/AnalyzePage';
import HistoryPage from './components/HistoryPage';
import SavedPage from './components/SavedPage';

type Route = { page: 'analyze' } | { page: 'history' } | { page: 'saved'; id: string };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h.startsWith('a/')) return { page: 'saved', id: h.slice(2) };
  if (h === 'history') return { page: 'history' };
  return { page: 'analyze' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <a href="#/" className="brand">Guild Logs</a>
        <nav>
          <a href="#/" className={route.page === 'analyze' ? 'on' : ''}>Analyse</a>
          <a href="#/history" className={route.page === 'history' ? 'on' : ''}>History</a>
        </nav>
      </header>
      <main>
        {route.page === 'analyze' && <AnalyzePage />}
        {route.page === 'history' && <HistoryPage />}
        {route.page === 'saved' && <SavedPage id={route.id} />}
      </main>
    </div>
  );
}
