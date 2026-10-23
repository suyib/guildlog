// Left-hand menu: app pages, then the sections of the analysis on screen.
import { useEffect, useState } from 'react';
import { type Me, loadMe } from '../api';
import { sectionsFor, useNav } from '../nav';
import Glyph from './Glyph';
import { ShareButton } from './ResultView';

export default function Sidebar({ page }: { page: 'analyze' | 'raids' | 'history' | 'changelog' | 'saved' }) {
  const { result, section, setSection, view } = useNav();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    loadMe().then(setMe);
  }, []);
  const sections = sectionsFor(page === 'history' || page === 'changelog' || page === 'raids' ? null : result, view);

  return (
    <aside className="sidebar">
      <a href="/" className="brand">
        <img className="logo" src="/logo.png" width={36} height={36} alt="" />
        <span className="brand-name">Guild <span>Logs</span></span>
      </a>

      <nav className="side-nav" aria-label="Pages">
        <a href="/" className={page === 'analyze' || page === 'saved' ? 'on' : ''}><Glyph name="compass" />Analyze</a>
        <a href="/#/raids" className={page === 'raids' ? 'on' : ''}><Glyph name="calendar" />Past raids</a>
        <a href="/#/history" className={page === 'history' ? 'on' : ''}><Glyph name="clock" />History</a>
      </nav>

      {sections.length > 0 && (
        <nav className="side-nav" aria-label="This analysis">
          <div className="side-label">This fight</div>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={section === s.id ? 'on' : ''}
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => {
                setSection(s.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <Glyph name={s.glyph} />
              {s.label}
            </button>
          ))}
        </nav>
      )}

      {sections.length > 0 && result && (
        <div className="side-card">
          <strong>Share this fight</strong>
          {result.id ? (
            <>
              <p>Send the link to your guild. It keeps working after Warcraft Logs archives the report.</p>
              <ShareButton id={result.id} />
            </>
          ) : (
            <p>This analysis wasn&rsquo;t saved, so there&rsquo;s no link yet. Check the Supabase settings in Vercel.</p>
          )}
        </div>
      )}

      {me?.signedIn && (
        <div className="side-user">
          {me.avatar ? <img src={me.avatar} width={28} height={28} alt="" /> : <span className="side-user-blank" aria-hidden="true"><Glyph name="users" size={16} /></span>}
          <span className="side-user-name">
            {me.name ?? 'Guild member'}
            <span className="muted small">{me.kind === 'password' ? 'Guild password' : me.officer ? 'Officer' : 'Member'}</span>
          </span>
          <a href="/api/login?logout=1" className="side-user-out">Sign out</a>
        </div>
      )}

      <div className="side-version">
        v{__APP_VERSION__} <a href="/#/changelog" className="changelog-link">Changelog</a>
        <a href="/terms" className="changelog-link">Terms</a>
        <a href="/privacy" className="changelog-link">Privacy</a>
      </div>
    </aside>
  );
}
