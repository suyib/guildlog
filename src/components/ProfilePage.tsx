// Your profile (opened from your name at the bottom of the menu): your Discord account and a card
// for each character you've claimed with the bot.
import { useEffect, useState } from 'react';
import type { PlayerGoal, ProfileCharacter, ProfileData } from '../../server/types';
import { RANK_LABEL, addGoal, loadPortrait, loadProfile, removeGoal } from '../api';
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

      {c.trend && c.trend.length > 1 && (
        <div>
          <div className="comp-label">{c.healer ? 'Healing parse' : 'Parse'} by week</div>
          <TrendHeadline c={c} />
          <ol className="trend">
            {c.trend.map((w) => (
              <li key={w.week}>
                <span className="muted">{new Date(`${w.week}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                <progress className={`bar ${parseCss(w.parse)}`} max={100} value={w.parse ?? 0} aria-label={`Average parse ${w.parse ?? 'unknown'}`} />
                <strong className={parseCss(w.parse)}>{w.parse ?? '–'}</strong>
              </li>
            ))}
          </ol>
        </div>
      )}

      <BossProgress c={c} />
      {c.status === 'approved' && <Goals c={c} />}

      {c.stats.length > 0 && (
        <div className="char-stats">
          {c.stats.map((s) => <span key={s.name} className="admin-char">{s.name} <strong>{s.value}</strong></span>)}
        </div>
      )}
    </article>
  );
}

/** "Up 12 points since Oct 6": the first week with a parse against the latest. */
function TrendHeadline({ c }: { c: ProfileCharacter }) {
  const weeks = (c.trend ?? []).filter((w) => w.parse !== null);
  if (weeks.length < 2) return null;
  const change = weeks.at(-1)!.parse! - weeks[0].parse!;
  const since = new Date(`${weeks[0].week}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (Math.abs(change) < 3) return <p className="small muted trend-head">Steady since {since}.</p>;
  return <p className={`small trend-head ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? `Up ${change} points since ${since}. Keep it going.` : `Down ${-change} points since ${since}. Your bosses below show where.`}</p>;
}

/** Each boss over the last 12 weeks: first parse to latest, and the best. */
function BossProgress({ c }: { c: ProfileCharacter }) {
  const list = (c.bosses ?? []).filter((b) => b.latest !== null);
  if (!list.length) return null;
  return (
    <div>
      <div className="comp-label">Each boss (last 12 weeks)</div>
      <table className="grid boss-trend">
        <thead><tr><th>Boss</th><th className="r">First</th><th className="r">Latest</th><th className="r">Best</th><th className="r">Kills</th></tr></thead>
        <tbody>
          {list.map((b) => {
            const change = b.first !== null && b.latest !== null && b.kills > 1 ? b.latest - b.first : null;
            return (
              <tr key={b.encounterId}>
                <td>{b.name}</td>
                <td className={`r ${parseCss(b.first)}`}>{b.first ?? '–'}</td>
                <td className={`r strong ${parseCss(b.latest)}`}>{b.latest ?? '–'}{change !== null && change !== 0 && <span className={`trend-delta ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? `+${change}` : change}</span>}</td>
                <td className={`r ${parseCss(b.best)}`}>{b.best ?? '–'}</td>
                <td className="r muted">{b.kills}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Personal goals for this character: a parse to reach on a boss (or any boss). The bot DMs when one's reached. */
function Goals({ c }: { c: ProfileCharacter }) {
  const [goals, setGoals] = useState<PlayerGoal[]>(c.goals ?? []);
  const [boss, setBoss] = useState('');
  const [target, setTarget] = useState(75);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bosses = c.bosses ?? [];
  const open = goals.filter((g) => !g.achievedAt);
  const done = goals.filter((g) => g.achievedAt).slice(0, 3);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const b = bosses.find((x) => String(x.encounterId) === boss);
      const g = await addGoal({ character: c.name, encounterId: b?.encounterId ?? null, encounter: b?.name ?? null, target });
      setGoals((list) => [g, ...list]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setGoals((list) => list.filter((g) => g.id !== id));
    await removeGoal(id).catch(() => undefined);
  }
  return (
    <div className="goals">
      <div className="comp-label">Your goals</div>
      {open.length === 0 && done.length === 0 && <p className="muted small">Pick a parse to aim for. When a raid gets you there, the bot sends you a DM.</p>}
      {open.length > 0 && (
        <ul className="goal-list">
          {open.map((g) => (
            <li key={g.id}>
              <span><strong className={parseCss(g.target)}>{g.target}+</strong> on {g.encounter ?? 'any boss'}</span>
              <button type="button" className="link-button small" onClick={() => remove(g.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <ul className="goal-list done">
          {done.map((g) => (
            <li key={g.id}><span><Glyph name="check" size={14} /> {g.target}+ on {g.encounter ?? 'any boss'}: reached with <strong className={parseCss(g.achievedParse)}>{g.achievedParse}</strong> on {day(g.achievedAt!)}</span></li>
          ))}
        </ul>
      )}
      <form className="goal-form" onSubmit={add}>
        <select value={boss} onChange={(e) => setBoss(e.target.value)} aria-label="Boss">
          <option value="">Any boss</option>
          {bosses.map((b) => <option key={b.encounterId} value={b.encounterId}>{b.name}</option>)}
        </select>
        <input type="number" min={1} max={100} value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Parse to reach" />
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add goal'}</button>
      </form>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
