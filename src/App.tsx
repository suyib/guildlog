import { useEffect, useState } from 'react';
import AdminPage from './components/AdminPage';
import AnalyzePage from './components/AnalyzePage';
import ChangelogPage from './components/ChangelogPage';
import HistoryPage from './components/HistoryPage';
import LegalPage from './components/LegalPage';
import ProfilePage from './components/ProfilePage';
import RaidsPage from './components/RaidsPage';
import RankingsPage from './components/RankingsPage';
import SavedPage from './components/SavedPage';
import Sidebar from './components/Sidebar';
import { NavProvider } from './nav';

type Route = { page: 'analyze' } | { page: 'history' } | { page: 'raids' } | { page: 'rankings' } | { page: 'admin' } | { page: 'me' } | { page: 'changelog' } | { page: 'saved'; id: string };

// Shareable analyses live at /a/<id>; the rest of the app uses hash routes (#/, #/raids and #/history).
function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'history') return { page: 'history' };
  if (h === 'raids') return { page: 'raids' };
  if (h === 'rankings' || h.startsWith('rankings?')) return { page: 'rankings' };
  if (h === 'admin') return { page: 'admin' };
  if (h === 'me') return { page: 'me' };
  if (h === 'changelog') return { page: 'changelog' };
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

  // Terms and Privacy are public pages with their own simple layout
  const legal = window.location.pathname.replace(/\/$/, '');
  if (legal === '/terms' || legal === '/privacy') return <LegalPage doc={legal === '/terms' ? 'terms' : 'privacy'} />;

  return (
    <NavProvider>
      <div className="app">
        <Sidebar page={route.page} />
        <main className="content">
          {route.page === 'analyze' && <AnalyzePage />}
          {route.page === 'raids' && <RaidsPage />}
          {route.page === 'rankings' && <RankingsPage key={window.location.hash} />}
          {route.page === 'admin' && <AdminPage />}
          {route.page === 'me' && <ProfilePage />}
          {route.page === 'history' && <HistoryPage />}
          {route.page === 'changelog' && <ChangelogPage />}
          {route.page === 'saved' && <SavedPage id={route.id} />}
        </main>
      </div>
    </NavProvider>
  );
}
