// The footer at the bottom of every page: links, support, and the fan-project disclaimer (not
// affiliated with Blizzard, Warcraft Logs or Discord; their trademarks are theirs).

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="footer-cols">
        <div className="footer-brand">
          <a href="/" className="brand">
            <img className="logo" src="/logo.png" width={28} height={28} alt="" />
            <span className="brand-name">Guild <span>Logs</span></span>
          </a>
          <p className="muted small">Raid log analysis for the guild, on the site and in Discord.</p>
          {__SUPPORT_URL__ && <a href={__SUPPORT_URL__} target="_blank" rel="noreferrer" className="small">Buy me a coffee</a>}
        </div>
        <nav aria-label="Site">
          <div className="footer-label">Site</div>
          <a href="/">Analyze</a>
          <a href="/#/raids">Past raids</a>
          <a href="/#/rankings">Rankings</a>
          <a href="/#/history">History</a>
        </nav>
        <nav aria-label="About">
          <div className="footer-label">About</div>
          <a href="/#/changelog">What&rsquo;s new (v{__APP_VERSION__})</a>
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
          <span className="muted small">Found a bug? Use Report a bug in Discord.</span>
        </nav>
      </div>
      <p className="footer-legal">
        Guild Logs is an independent, non-commercial fan project. It isn&rsquo;t affiliated with, endorsed or sponsored by Blizzard Entertainment,
        Warcraft Logs or Discord. World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard
        Entertainment, Inc. in the U.S. and/or other countries, and game names, images and data belong to them. Combat logs come from Warcraft Logs,
        and icons are loaded from Wowhead. Analyses are automated and can be wrong: treat them as a starting point, not a final judgement.
      </p>
      <p className="footer-legal">&copy; {year} Guild Logs</p>
    </footer>
  );
}
