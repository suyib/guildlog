// Terms of Service and Privacy Policy. Public pages (no guild password), so Discord and anyone
// asked to use the bot can read them. Keep the "Last updated" date current when editing.

const UPDATED = 'October 20, 2026';
const CONTACT = 'message Suyin on the guild Discord server';

export default function LegalPage({ doc }: { doc: 'terms' | 'privacy' }) {
  return (
    <div className="legal">
      <header className="legal-head">
        <a href="/" className="brand">
          <img className="logo" src="/logo.png" width={36} height={36} alt="" />
          <span className="brand-name">Guild <span>Logs</span></span>
        </a>
        <nav className="legal-nav" aria-label="Legal">
          <a href="/terms" className={doc === 'terms' ? 'on' : ''}>Terms of Service</a>
          <a href="/privacy" className={doc === 'privacy' ? 'on' : ''}>Privacy Policy</a>
        </nav>
      </header>
      <article className="panel legal-body">{doc === 'terms' ? <Terms /> : <Privacy />}</article>
    </div>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <p>
        Guild Logs is a small, non-commercial tool run by Suyin for members of our World of Warcraft guild. It includes the website and the Guild Logs
        Discord bot (together, &ldquo;the service&rdquo;). By using the service you agree to these terms.
      </p>

      <h2>Who can use it</h2>
      <ul>
        <li>The website is for guild members who have been given the guild password. Don&rsquo;t share the password outside the guild.</li>
        <li>The Discord bot is for members of our Discord server. You must meet Discord&rsquo;s minimum age and follow Discord&rsquo;s own terms.</li>
      </ul>

      <h2>What the service does</h2>
      <p>
        It reads combat logs that have been uploaded to Warcraft Logs, analyzes a player&rsquo;s performance and saves the result so it can be shared and
        tracked over time. With the Discord bot you can claim your own characters, look up your progress and receive summaries by direct message.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only claim characters that are yours. Officers can reject or remove claims.</li>
        <li>Don&rsquo;t try to break, overload or scrape the service, or get around the password.</li>
        <li>Use shared analyses to help each other improve, not to harass anyone.</li>
      </ul>

      <h2>Accuracy</h2>
      <p>
        Analyses are automated. Some points, such as &ldquo;likely avoidable&rdquo; damage or what to work on, are rules of thumb and can be wrong for a
        particular boss or role. Treat them as a starting point, not a final judgement. Parse percentiles come from Warcraft Logs at the time an analysis
        is run.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided free and as is, without any warranty. It may change, be unavailable or be shut down at any time, and saved data may be
        lost. To the extent the law allows, Suyin isn&rsquo;t liable for any loss arising from using it.
      </p>

      <h2>Third-party services</h2>
      <p>
        The service relies on Warcraft Logs, Blizzard, Discord, Vercel and Supabase, each under their own terms. Guild Logs isn&rsquo;t affiliated with
        or endorsed by Blizzard Entertainment, Warcraft Logs or Discord. World of Warcraft is a trademark of Blizzard Entertainment.
      </p>

      <h2>Ending access</h2>
      <p>Access can be removed from anyone who breaks these terms, for example by changing the password or removing claims.</p>

      <h2>Changes</h2>
      <p>These terms may be updated. The date at the top shows the latest version, and big changes will be announced in the guild Discord.</p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of England and Wales.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: {CONTACT}.</p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <p>
        This policy explains what Guild Logs (the website and the Discord bot) stores, why, and what you can ask for. Guild Logs is run by Suyin, who is
        responsible for this data under UK data protection law.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Analyses.</strong> When someone runs an analysis, we save the result: character name, realm, class and spec, the boss, and combat
          numbers such as damage, casts, buffs, deaths, damage taken, gear and parse percentile. This comes from logs already uploaded to Warcraft Logs.
        </li>
        <li>
          <strong>Discord links.</strong> If you use the bot, we store your Discord user ID and username, the characters you claim, and whether an officer
          approved the claim.
        </li>
        <li>
          <strong>A sign-in cookie.</strong> After you enter the guild password, a cookie named <code>gl_session</code> keeps you signed in for up to 30
          days. It contains no personal details. There are no tracking or advertising cookies, and no analytics.
        </li>
      </ul>

      <h2>Why</h2>
      <ul>
        <li>To show and share analyses, and keep them after Warcraft Logs archives a report.</li>
        <li>To track a character&rsquo;s progress over time and send weekly summaries to the person who claimed it.</li>
        <li>To keep the site private to the guild.</li>
      </ul>
      <p>
        We rely on legitimate interests (running a tool the guild asked for) for analyses, and on your choice to claim a character for Discord features.
        You can unclaim at any time.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>Anyone with the guild password can see saved analyses. Share links also need the password.</li>
        <li>
          Services that run Guild Logs process data for us: Vercel (hosting; keeps short-term request logs including IP addresses), Supabase (database),
          Warcraft Logs (combat data), Blizzard (character portraits) and Discord (the bot and direct messages).
        </li>
        <li>
          Your browser loads fonts from Google Fonts and game icons from Wowhead&rsquo;s image server, so those services see your IP address when the
          page loads.
        </li>
      </ul>
      <p>We don&rsquo;t sell data or use it for advertising.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Analyses are kept until they&rsquo;re deleted, so progress can be tracked over time.</li>
        <li>Discord links are kept until you unclaim, leave the server or ask us to remove them.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data held about you or your characters, to correct it, or to delete it, and you can object to us keeping it. To do any
        of these, {CONTACT}. You can also complain to the UK Information Commissioner&rsquo;s Office (ico.org.uk).
      </p>

      <h2>Children</h2>
      <p>The service isn&rsquo;t meant for anyone under the minimum age to use Discord in their country.</p>

      <h2>Changes</h2>
      <p>This policy may be updated. The date at the top shows the latest version, and big changes will be announced in the guild Discord.</p>
    </>
  );
}
