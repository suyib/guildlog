// Your raid: one character's night, the same five pages the bot DMs after a raid (Quick summary,
// Rotation & cooldowns, Damage or Healing, Gear & stats, Survival), plus the boss list, your last
// raid, your goals, the raid's achievements and your consumables. Your own characters; officers,
// raid leaders and loot council can open anyone's (like /check).
import { useEffect, useState } from 'react';
import type { YourRaid } from '../../server/types';
import { loadYourRaid } from '../api';
import { raidAchievements } from '../achievements';
import { mmss, n0 } from '../format';
import { go, hashParam } from '../url';
import { EmbedFields, MdBlock } from './Embed';
import { useHome } from './Home';
import { RaidCardBody } from './RaidCard';
import { ShareButton } from './ResultView';
import { BossIcon, ClassIcon, EmptyNote, GameIcon, classCss, parseCss } from './icons';

const TABS = [
  ['summary', 'Summary'],
  ['rotation', 'Rotation & cooldowns'],
  ['damage', 'Damage'],
  ['gear', 'Gear & stats'],
  ['survival', 'Survival'],
] as const;
type Tab = (typeof TABS)[number][0];

const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const address = (host: string, raid: string, character: string, tab: Tab) =>
  `/#/me/raid?host=${encodeURIComponent(host)}&raid=${encodeURIComponent(raid)}&character=${encodeURIComponent(character)}${tab === 'summary' ? '' : `&tab=${tab}`}`;

export default function YourRaidPage() {
  const host = hashParam('host') ?? '';
  const raid = hashParam('raid') ?? '';
  const [character, setCharacter] = useState(hashParam('character'));
  const [tab, setTab] = useState<Tab>((TABS.find(([id]) => id === hashParam('tab'))?.[0]) ?? 'summary');
  const [data, setData] = useState<YourRaid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const home = useHome();

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    loadYourRaid(host, raid, character).then((d) => {
      if (!live) return;
      setData(d);
      go(address(d.host, d.code, d.character, tab), true);
    }).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [host, raid, character]);

  const pick = (t: Tab) => {
    setTab(t);
    if (data) go(address(data.host, data.code, data.character, t), true);
  };

  if (error) return <section className="panel"><h1>Your raid</h1><EmptyNote icon="inv_misc_note_01">{error}</EmptyNote></section>;
  if (!data) return <section className="panel home-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="muted">Reading your raid&hellip;</span></section>;

  const d = data;
  const nightLink = `/?log=${encodeURIComponent(`https://${d.host}/reports/${d.code}`)}`;
  const fightLink = (b: YourRaid['bosses'][number]) => `/?log=${encodeURIComponent(`https://${d.host}/reports/${d.code}?fight=${b.fightId}&source=${b.playerId}`)}`;
  const unit = d.healer ? 'HPS' : 'DPS';
  const achievements = raidAchievements(d.card, { code: d.code, start: d.startTime, zones: home?.zones });
  const summary = d.pages.summary;
  const pointsOf = (name: string) => summary.fields?.find((f) => f.name === name)?.value ?? '';

  return (
    <div className="your-raid">
      <header className="zone-card hero">
        <RaidCardBody
          id={d.zone?.id}
          name={d.zone?.name ?? d.title}
          title={d.lookingAtSomeoneElse ? `${d.character}'s night: ${d.title}` : `Your night: ${d.title}`}
          heading="h1"
          sub={`${new Date(d.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${d.card.kills} of ${d.card.bosses.length} bosses · ${d.card.raidSeconds ? hm(d.card.raidSeconds) : ''}`}
          details={
            <span className="zone-line with-icon">
              <ClassIcon className={d.className} spec={d.specName} size={18} />
              <strong className={classCss(d.className)}>{d.character}</strong> {spaced(d.specName)} {d.className}{d.itemLevel ? ` · item level ${Math.round(d.itemLevel)}` : ''}
            </span>
          }
        />
      </header>

      <div className="row wrap-center your-raid-actions">
        {d.others.length > 0 && (
          <select value={d.character} onChange={(e) => setCharacter(e.target.value)} aria-label="Character">
            {[d.character, ...d.others].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <a className="button ghost" href={nightLink}>Whole night</a>
        <ShareButton path={address(d.host, d.code, d.character, tab)} label="Copy link" />
      </div>
      {d.lookingAtSomeoneElse && <p className="muted small">You&rsquo;re looking at {d.character}&rsquo;s raid as an officer. They see the same page.</p>}
      {d.pending > 0 && <p className="warning">{d.pending} boss kill{d.pending === 1 ? ' is' : 's are'} still being read; open the page again in a minute to include {d.pending === 1 ? 'it' : 'them'}.</p>}

      <div className="seg tabs-seg" role="tablist" aria-label="Pages">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => pick(id)}>
            {id === 'damage' && d.healer ? 'Healing' : label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <>
          <EmbedFields embed={summary} skip={['What went well', 'What to work on', 'Personal bests']} />
          <div className="grid-2 feedback">
            <section className="panel"><h2 className="panel-title">What went well</h2><MdBlock text={pointsOf('What went well')} className="md-good" /></section>
            <section className="panel"><h2 className="panel-title">What to work on</h2><MdBlock text={pointsOf('What to work on')} className="md-work" /></section>
          </div>
          <section className="panel">
            <h2 className="panel-title">Boss by boss</h2>
            <div className="scroll">
              <table className="grid">
                <thead><tr><th>Boss</th><th className="r">{d.healer ? 'Healing parse' : 'Parse'}</th><th className="r">{unit}</th><th className="r">Active</th><th className="r">Deaths</th><th className="r">Time</th></tr></thead>
                <tbody>
                  {d.bosses.map((b) => (
                    <tr key={b.fightId}>
                      <td><a href={fightLink(b)} className="with-icon"><BossIcon id={b.encounterId} size="small" />{b.name}</a></td>
                      <td className={`r strong ${parseCss(b.parse)}`}>{b.parse === null ? '–' : Math.round(b.parse)}</td>
                      <td className="r">{n0(b.perSecond)}</td>
                      <td className="r">{b.activePct === null ? '–' : `${Math.round(b.activePct)}%`}</td>
                      <td className={`r${b.deaths ? ' warn-text' : ''}`}>{b.deaths}</td>
                      <td className="r muted">{mmss(b.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Click a boss for its full analysis.</p>
          </section>
          <div className="grid-3">
            <section className="panel">
              <h2 className="panel-title">Against your last raid</h2>
              {d.vsLast ? (
                <p className="small">
                  {d.vsLast.parse !== null && d.vsLast.parseNow !== null && <>Average parse <Delta v={d.vsLast.parseNow - d.vsLast.parse} /> ({d.vsLast.parse} to {d.vsLast.parseNow}) · </>}
                  {unit} <Delta v={d.vsLast.perSecond && d.vsLast.perSecondNow ? Math.round(((d.vsLast.perSecondNow - d.vsLast.perSecond) / d.vsLast.perSecond) * 100) : 0} pct />
                  <span className="muted"> · against {d.vsLast.title ?? 'your raid'} on {new Date(d.vsLast.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </p>
              ) : <p className="muted small">Shows here once you have an earlier raid on Past raids.</p>}
            </section>
            <section className="panel">
              <h2 className="panel-title">Your goals</h2>
              {d.lookingAtSomeoneElse ? <p className="muted small">Goals are only shown to their owner.</p> : d.goals.filter((g) => !g.achievedAt).length ? (
                <ul className="goal-list">
                  {d.goals.filter((g) => !g.achievedAt).map((g) => {
                    const tonight = d.bosses.filter((b) => !g.encounterId || b.encounterId === g.encounterId).map((b) => b.parse ?? 0);
                    const best = tonight.length ? Math.round(Math.max(...tonight)) : null;
                    return <li key={g.id}><span><strong className={parseCss(g.target)}>{g.target}+</strong> on {g.encounter ?? 'any boss'}</span><span className="muted small">{best === null ? 'not fought' : best >= g.target ? 'reached!' : `best tonight ${best}, ${g.target - best} to go`}</span></li>;
                  })}
                </ul>
              ) : <p className="muted small">No goals yet. <a href="/#/me">Set one on your profile.</a></p>}
            </section>
            <section className="panel">
              <h2 className="panel-title">Achievements</h2>
              {achievements.length ? <ul className="goal-list">{achievements.map((a) => <li key={a.key}><span>{a.name}</span><span className="muted small">{a.sub}</span></li>)}</ul> : <p className="muted small">None this raid.</p>}
            </section>
          </div>
        </>
      )}

      {tab !== 'summary' && (
        <>
          {d.pages[tab].description && <MdBlock text={d.pages[tab].description!} className="muted-md" />}
          <EmbedFields embed={d.pages[tab]} />
          {tab === 'survival' && <ConsumablesGrid bosses={d.bosses} />}
        </>
      )}
      <p className="muted small">The same pages the bot sends you by DM after a raid.</p>
    </div>
  );
}

function Delta({ v, pct = false }: { v: number; pct?: boolean }) {
  if (!v) return <strong className="muted">same</strong>;
  return <strong className={v > 0 ? 'delta-good' : 'delta-bad'}>{v > 0 ? '+' : '−'}{Math.abs(v)}{pct ? '%' : ''}</strong>;
}

/** Flask, elixir, food and potion on each boss, as ticks and crosses. GAME CONTENT (icons) */
function ConsumablesGrid({ bosses }: { bosses: YourRaid['bosses'] }) {
  const rows = bosses.filter((b) => b.consumes || b.potion !== null);
  if (!rows.length) return null;
  const mark = (ok: boolean | null) => (ok === null ? <span className="cons-cell none">–</span> : <span className={`cons-cell ${ok ? 'yes' : 'no'}`}>{ok ? '✓' : '✕'}</span>);
  return (
    <section className="panel">
      <h2 className="panel-title">Consumables, boss by boss</h2>
      <div className="scroll">
        <table className="grid cons-grid">
          <thead>
            <tr>
              <th>Boss</th>
              <th className="c"><GameIcon file="inv_potion_41" size={18} /> Flask</th>
              <th className="c"><GameIcon file="inv_potion_62" size={18} /> Elixir</th>
              <th className="c"><GameIcon file="inv_misc_food_64" size={18} /> Food</th>
              <th className="c"><GameIcon file="inv_alchemy_endlessflask_06" size={18} /> Potion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.fightId}>
                <td><span className="with-icon"><BossIcon id={b.encounterId} size="small" />{b.name}</span></td>
                <td className="c">{mark(b.consumes ? b.consumes.flask : null)}</td>
                <td className="c">{mark(b.consumes ? b.consumes.elixirs > 0 || b.consumes.flask : null)}</td>
                <td className="c">{mark(b.consumes ? b.consumes.food : null)}</td>
                <td className="c">{mark(b.potion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">A flask covers both elixirs. Only you and officers see this.</p>
    </section>
  );
}
