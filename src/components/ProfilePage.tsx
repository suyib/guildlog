// Your profile (opened from your name at the bottom of the menu): your Discord account and a card
// for each character you've claimed with the bot.
import { useEffect, useState } from 'react';
import type { ProfileCharacter, ProfileData } from '../../server/types';
import { RANK_LABEL, loadPortrait, loadProfile } from '../api';
import { n0 } from '../format';
import Glyph from './Glyph';
import { ClassIcon, classCss, parseCss } from './icons';

const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
const analysisLink = (c: ProfileCharacter) =>
  c.lastRaid ? `/?log=${encodeURIComponent(`https://${c.lastRaid.host}/reports/${c.lastRaid.code}?fight=${c.lastRaid.best.fightId}&source=${c.lastRaid.best.playerId}`)}` : null;
const raidLink = (c: ProfileCharacter) => (c.lastRaid ? `/?log=${encodeURIComponent(`https://${c.lastRaid.host}/reports/${c.lastRaid.code}`)}` : null);

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadProfile().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <section className="panel"><h1>Your profile</h1><p className="error">{error}</p></section>;
  if (!data) return <section className="panel"><h1>Your profile</h1><p className="muted">Loading…</p></section>;

  return (
    <>
      <section className="panel profile-head">
        {data.avatar ? <img src={data.avatar} width={64} height={64} alt="" /> : <span className="kpi-icon big"><Glyph name="users" size={24} /></span>}
        <div>
          <div className="eyebrow">{data.server ?? 'Discord'}{data.firstSeen ? ` · connected ${day(data.firstSeen)}` : ''}{data.signIns ? ` · ${data.signIns} sign-in${data.signIns === 1 ? '' : 's'}` : ''}</div>
          <h1>{data.name}</h1>
          <span className={`badge rank-${data.rank}`}>{RANK_LABEL[data.rank]}</span>
        </div>
        <a className="button ghost profile-out" href="/api/login?logout=1">Sign out</a>
      </section>

      <section className="panel">
        <h2 className="panel-title">Your characters</h2>
        {data.characters.length === 0 ? (
          <p className="muted">No characters yet. Use <strong>/claim</strong> in Discord, and once an officer approves it your character shows here with its latest raid.</p>
        ) : (
          <div className="char-grid">
            {data.characters.map((c) => <CharacterCard key={`${c.name}-${c.realm}`} c={c} />)}
          </div>
        )}
      </section>
    </>
  );
}

function CharacterCard({ c }: { c: ProfileCharacter }) {
  const [portrait, setPortrait] = useState<string | null>(null);
  useEffect(() => {
    if (!c.lastRaid || !c.realm) return;
    let live = true;
    loadPortrait({ host: c.lastRaid.host, reportCode: c.lastRaid.code, name: c.name, server: c.realm }).then((u) => live && setPortrait(u));
    return () => {
      live = false;
    };
  }, [c.name, c.realm, c.lastRaid?.code]);
  const r = c.lastRaid;
  const unit = c.healer ? 'HPS' : 'DPS';
  return (
    <article className={`char-card ${c.className ? `${classCss(c.className)}-border` : ''}`}>
      <header className="char-head">
        {portrait ? <img className="portrait" src={portrait} width={44} height={44} alt="" /> : c.className ? <ClassIcon className={c.className} size={44} /> : <span className="kpi-icon big"><Glyph name="users" size={22} /></span>}
        <div>
          <h3 className={c.className ? classCss(c.className) : ''}>{c.name}</h3>
          <div className="muted small">
            {[c.level ? `Level ${c.level}` : null, c.specName || c.className ? `${c.specName ? spaced(c.specName) : ''} ${c.className ?? ''}`.trim() : null, c.realm].filter(Boolean).join(' · ') || 'Not seen in a raid yet'}
          </div>
        </div>
      </header>
      {c.status !== 'approved' && <span className="badge badge-warn">Claim waiting for an officer</span>}

      <dl className="facts">
        <div><dt>Item level</dt><dd>{c.itemLevel ?? '–'}</dd></div>
        <div><dt>Role</dt><dd>{c.role === 'tank' ? 'Tank' : c.role === 'healer' ? 'Healer' : c.role === 'dps' ? 'Damage' : '–'}</dd></div>
        <div><dt>Last 8 weeks</dt><dd>{c.attendance.of ? `${c.attendance.attended} of ${c.attendance.of}` : "–"}</dd></div>
        <div><dt>All raids</dt><dd>{c.raidsAttended}</dd></div>
      </dl>
      {c.attendance.of > 0 && (
        <progress className={`bar ${c.className ? `${classCss(c.className)}-bar` : ''}`} max={c.attendance.of} value={c.attendance.attended} aria-label={`Attended ${c.attendance.attended} of ${c.attendance.of} raids`} />
      )}

      {r ? (
        <div className="char-last">
          <div className="comp-label">Latest raid</div>
          <a href={raidLink(c)!}><strong>{r.title}</strong></a>
          <span className="muted small">{day(r.date)} · {r.bosses} boss{r.bosses === 1 ? '' : 'es'} · {n0(r.perSecond)} {unit} · {r.deaths} death{r.deaths === 1 ? '' : 's'}</span>
          <span className="small">
            {c.healer ? 'Healing parse' : 'Average parse'} <strong className={parseCss(r.avgParse)}>{r.avgParse ?? '–'}</strong>
            {r.best.parse !== null && <> · best on {r.best.boss} <strong className={parseCss(r.best.parse)}>{Math.round(r.best.parse)}</strong></>}
          </span>
          <a className="button ghost" href={analysisLink(c)!}><Glyph name="bars" size={16} />Analyze {r.best.boss}</a>
        </div>
      ) : (
        <p className="muted small">No raids with this character yet. It fills in after the next /raidend.</p>
      )}

      {c.stats.length > 0 && (
        <div className="char-stats">
          {c.stats.map((s) => <span key={s.name} className="admin-char">{s.name} <strong>{s.value}</strong></span>)}
        </div>
      )}
    </article>
  );
}
