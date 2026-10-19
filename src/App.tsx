import { useEffect, useState } from 'react';
import AnalyzePage from './components/AnalyzePage';
import HistoryPage from './components/HistoryPage';
import SavedPage from './components/SavedPage';
import Sidebar from './components/Sidebar';
import { NavProvider } from './nav';

type Route = { page: 'analyze' } | { page: 'history' } | { page: 'saved'; id: string };

// Shareable analyses live at /a/<id>; the rest of the app uses hash routes (#/ and #/history).
function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'history') return { page: 'history' };
  if (h.startsWith('a/')) return { page: 'saved', id: h.slice(2) }; // older #/a/<id> links
  const m = window.location.pathname.match(/^\/a\/([0-9a-f-]{36})\/?$/i);
  if (m && !h) return { page: 'saved', id: m[1] };
  return { page: 'analyze' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  return (
    <NavProvider>
      <div className="app">
        <Sidebar page={route.page} />
        <main className="content">
          {route.page === 'analyze' && <AnalyzePage />}
          {route.page === 'history' && <HistoryPage />}
          {route.page === 'saved' && <SavedPage id={route.id} />}
        </main>
      </div>
    </NavProvider>
  );
}
