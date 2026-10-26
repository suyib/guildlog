// Left-hand menu: app pages, then the sections of the analysis on screen.
import { useEffect, useState } from 'react';
import { type Me, RANK_LABEL, loadMe } from '../api';
import { sectionsFor, useNav } from '../nav';
import Glyph from './Glyph';
import { ShareButton } from './ResultView';

export default function Sidebar({ page }: { page: 'analyze' | 'raids' | 'rankings' | 'history' | 'admin' | 'me' | 'changelog' | 'saved' }) {
  const { result, section, setSection, view } = useNav();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    loadMe().then(setMe);
  }, []);
  const sections = sectionsFor(page === 'history' || page === 'changelog' || page === 'raids' || page === 'rankings' || page === 'admin' || page === 'me' ? null : result, view);

  return (
    <aside className="sidebar">
      <a href="/" className="brand">
        <img className="logo" src="/logo.png" width={36} height={36} alt="" />
        <span className="brand-name">Guild <span>Logs</span></span>
      </a>

      {/* Guests (a shared link, not signed in) only see the analysis they were sent */}
      {me?.signedIn && (
        <nav className="side-nav" aria-label="Pages">
          <a href="/" className={page === 'analyze' || page === 'saved' ? 'on' : ''}><Glyph name="compass" />Analyze</a>
          <a href="/#/raids" className={page === 'raids' ? 'on' : ''}><Glyph name="calendar" />Past raids</a>
          <a href="/#/rankings" className={page === 'rankings' ? 'on' : ''}><Glyph name="bars" />Rankings</a>
          <a href="/#/history" className={page === 'history' ? 'on' : ''}><Glyph name="clock" />History</a>
          {me?.officer && <a href="/#/admin" className={page === 'admin' ? 'on' : ''}><Glyph name="shield" />Admin</a>}
        </nav>
      )}

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

      {me && !me.signedIn && (
        <div className="side-card">
          <strong>Guild member?</strong>
          <p>Sign in with Discord to analyze your own fights.</p>
          <a className="button" href={`/api/login?discord=1&next=${encodeURIComponent(window.location.pathname)}`}>Sign in with Discord</a>
        </div>
      )}

      {me?.signedIn && (
        <div className={`side-user${page === 'me' ? ' on' : ''}`}>
          {/* Discord sign-ins open their profile; the guild password has no profile */}
          {me.kind === 'discord' ? (
            <a href="/#/me" className="side-user-link" title="Your profile and characters" aria-label="Your profile and characters">
              {me.avatar ? <img src={me.avatar} width={28} height={28} alt="" /> : <span className="side-user-blank" aria-hidden="true"><Glyph name="users" size={16} /></span>}
              <span className="side-user-name">
                {me.name ?? 'Guild member'}
                <span className="muted small">{me.rank ? RANK_LABEL[me.rank] : 'Member'}</span>
              </span>
            </a>
          ) : (
            <span className="side-user-link">
              <span className="side-user-blank" aria-hidden="true"><Glyph name="users" size={16} /></span>
              <span className="side-user-name">Guild member<span className="muted small">Guild password</span></span>
            </span>
          )}
          <a href="/api/login?logout=1" className="side-user-out">Sign out</a>
        </div>
      )}

      {__SUPPORT_URL__ && (
        <a href={__SUPPORT_URL__} target="_blank" rel="noreferrer" className="support-link">
          <Glyph name="coffee" size={16} />Buy me a coffee
        </a>
      )}

      <div className="side-version">
        v{__APP_VERSION__} <a href="/#/changelog" className="changelog-link">Changelog</a>
        <a href="/terms" className="changelog-link">Terms</a>
        <a href="/privacy" className="changelog-link">Privacy</a>
      </div>
    </aside>
  );
}
