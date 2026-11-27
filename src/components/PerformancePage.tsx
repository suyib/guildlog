// Performance (officers, raid leaders and loot council): who's doing well and who could use a hand,
// built by the same code as the bot's /performance, plus everyone's numbers in one table. Clicking
// someone opens what /performance character: sends, with who claimed them and the officer note.
import { useEffect, useMemo, useState } from 'react';
import type { PerformanceCharacter, PerformancePage as Perf, SavedRaid } from '../../server/types';
import { type PerfChoice, loadPerfCharacter, loadPerformance, loadRaids, sendPerfDm } from '../api';
import { go, hashParam } from '../url';
import { EmbedView, MdBlock } from './Embed';
import { ClassIcon, EmptyNote, TileIcon, classCss, parseCss } from './icons';

type Sort = 'name' | 'kills' | 'parse' | 'best' | 'deaths' | 'activePct' | 'consumesPct' | 'attended';
const ROLES = [['all', 'Everyone'], ['dps', 'Damage'], ['healer', 'Healers'], ['tank', 'Tanks']] as const;

const choiceFromAddress = (): PerfChoice => {
  const r = hashParam('range');
  return { range: r === 'raid' || r === '8w' ? r : '4w', host: hashParam('host'), raid: hashParam('raid') };
};
const address = (c: PerfChoice, character?: string | null) =>
  `/#/performance?range=${c.range}${c.host && c.raid ? `&host=${encodeURIComponent(c.host)}&raid=${encodeURIComponent(c.raid)}` : ''}${character ? `&character=${encodeURIComponent(character)}` : ''}`;

export default function PerformancePage() {
  const [choice, setChoice] = useState<PerfChoice>(choiceFromAddress);
  const [open, setOpen] = useState<string | null>(hashParam('character'));
  const [data, setData] = useState<Perf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raids, setRaids] = useState<SavedRaid[]>([]);
  const [role, setRole] = useState<(typeof ROLES)[number][0]>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ by: Sort; desc: boolean }>({ by: 'parse', desc: true });
  const [dm, setDm] = useState<string | null>(null);

  useEffect(() => {
    loadRaids().then((r) => setRaids(r.raids.filter((x) => x.startTime && x.card))).catch(() => undefined);
  }, []);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    loadPerformance(choice).then((d) => live && setData(d)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [choice.range, choice.host, choice.raid]);

  const change = (c: PerfChoice) => {
    setChoice(c);
    setOpen(null);
    go(address(c));
  };
  const toggle = (name: string) => {
    const next = open === name ? null : name;
    setOpen(next);
    go(address(choice, next), true);
  };
  const sendWhole = async () => {
    setDm('Sending…');
    try {
      await sendPerfDm(choice);
      setDm('Sent to your Discord DMs.');
    } catch (e) {
      setDm((e as Error).message);
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const f = search.trim().toLowerCase();
    const list = data.players.filter((p) => (role === 'all' || p.role === role) && (!f || p.name.toLowerCase().includes(f) || p.spec.toLowerCase().includes(f)));
    const v = (p: Perf['players'][number]) => (sort.by === 'name' ? p.name : p[sort.by] ?? -1);
    return [...list].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y);
      return sort.desc ? -c : c;
    });
  }, [data, role, search, sort]);

  const raidValue = choice.host && choice.raid ? `${choice.host}:${choice.raid}` : '';
  const byName = new Map((data?.players ?? []).map((p) => [p.name, p]));
  const ranked = (data?.players ?? []).filter((p) => p.parse !== null);
  const avgParse = ranked.length ? Math.round(ranked.reduce((t, p) => t + p.parse!, 0) / ranked.length) : null;
  const cons = (data?.players ?? []).map((p) => p.consumesPct).filter((v): v is number => v !== null);
  const deaths = (data?.players ?? []).reduce((t, p) => t + p.deaths, 0);
  const killsTotal = (data?.players ?? []).reduce((t, p) => t + p.kills, 0);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h1>Performance</h1>
            <p className="help">The same report as /performance in Discord, for officers, raid leaders and loot council.</p>
          </div>
          <button type="button" className="ghost" onClick={sendWhole}>Send me this as a DM</button>
        </div>
        <div className="row wrap-center perf-filters">
          <select value={choice.range} disabled={!!raidValue} onChange={(e) => change({ range: e.target.value as PerfChoice['range'] })} aria-label="Period">
            <option value="raid">The last raid</option>
            <option value="4w">The last 4 weeks</option>
            <option value="8w">The last 8 weeks</option>
          </select>
          <select value={raidValue} onChange={(e) => {
            const [h, c] = e.target.value.split(':');
            change(e.target.value ? { range: choice.range, host: h, raid: c } : { range: choice.range });
          }} aria-label="One raid">
            <option value="">Every raid in the period</option>
            {raids.map((r) => <option key={r.code} value={`${r.host}:${r.code}`}>{new Date(r.startTime!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: {r.title ?? r.code}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Role">
            {ROLES.map(([id, label]) => <button key={id} type="button" className={role === id ? 'on' : ''} aria-pressed={role === id} onClick={() => setRole(id)}>{label}</button>)}
          </div>
          <input className="filter" placeholder="Find a character" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a character" />
        </div>
        {dm && <p className="muted small">{dm}</p>}
        {data && <p className="perf-caveat">{data.caveat}</p>}
      </section>

      {error && <section className="panel"><EmptyNote icon="inv_misc_note_01">{error}</EmptyNote></section>}
      {!data && !error && <section className="panel home-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="muted">Reading the raids&hellip;</span></section>}

      {data && !data.players.length && (
        <section className="panel"><EmptyNote icon="inv_misc_book_09">Not enough kills read in {data.label} yet (each player needs at least {data.minKills}). Raids are read after /raidend, or from Past raids.</EmptyNote></section>
      )}

      {data && data.players.length > 0 && (
        <>
          <p className="muted small">{data.label}: {data.raids} raid{data.raids === 1 ? '' : 's'}, {data.kills} boss kill{data.kills === 1 ? '' : 's'}{data.itemLevel ? `, average item level ${data.itemLevel}` : ''}.{data.pending ? ` ${data.pending} kill${data.pending === 1 ? ' is' : 's are'} still being read.` : ''}</p>
          <div className="kpis five">
            <Kpi glyph="users" label="Raiders" value={String(data.players.length)} sub={data.skipped ? `${data.skipped} with one kill left out` : 'with enough kills to judge'} />
            <Kpi glyph="bars" label="Average parse" value={avgParse === null ? '–' : String(avgParse)} valueCls={parseCss(avgParse)} sub="damage and healing parses" />
            <Kpi glyph="check" label="Doing well" value={String(data.high.length)} sub={`could use a hand: ${data.low.length}`} />
            <Kpi glyph="alert" label="Deaths" value={killsTotal ? (deaths / killsTotal).toFixed(2) : '–'} sub="per player per kill" />
            <Kpi glyph="shield" label="Consumables" value={cons.length ? `${Math.round(cons.reduce((t, v) => t + v, 0) / cons.length)}%` : '–'} sub="kills with flask and potion" />
          </div>

          <div className="grid-2">
            <section className="panel">
              <h2 className="panel-title">Doing well</h2>
              {data.high.length ? data.high.map((name) => (
                <PersonRow key={name} p={byName.get(name)!} open={open === name} onClick={() => toggle(name)}>
                  {open === name && <Drawer choice={choice} name={name} />}
                </PersonRow>
              )) : <p className="muted small">Nobody averaged a parse of 75 or more with few deaths.</p>}
            </section>
            <section className="panel">
              <h2 className="panel-title">Could use a hand</h2>
              {data.low.length ? data.low.map((x) => (
                <PersonRow key={x.name} p={byName.get(x.name)!} why={x.why} open={open === x.name} onClick={() => toggle(x.name)}>
                  {open === x.name && <Drawer choice={choice} name={x.name} />}
                </PersonRow>
              )) : <p className="muted small">Nobody stands out: parses, deaths and item level all look fine.</p>}
            </section>
          </div>

          {data.watch.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">Things to watch for</h2>
              <MdBlock text={data.watch.map((w) => `• ${w}`).join('\n')} />
            </section>
          )}

          <section className="panel">
            <h2 className="panel-title">Everyone ({rows.length})</h2>
            <div className="scroll">
              <table className="grid perf-table">
                <thead>
                  <tr>
                    {([['name', 'Player'], ['kills', 'Kills'], ['parse', 'Avg parse'], ['best', 'Best'], ['deaths', 'Deaths'], ['activePct', 'Active'], ['consumesPct', 'Consumables'], ['attended', 'Raids']] as [Sort, string][]).map(([key, label]) => (
                      <th key={key} className={key === 'name' ? '' : 'r'}>
                        <button type="button" className="link-button sort-button" aria-sort={sort.by === key ? (sort.desc ? 'descending' : 'ascending') : 'none'} onClick={() => setSort((s) => ({ by: key, desc: s.by === key ? !s.desc : key !== 'name' }))}>
                          {label}{sort.by === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.name} className={`clickable${open === p.name ? ' on' : ''}`} onClick={() => toggle(p.name)}>
                      <td>
                        <span className="perf-who">
                          <ClassIcon className={p.className} size={22} />
                          <span><strong className={`perf-link ${classCss(p.className)}`}>{p.name}</strong><span className="muted small">{p.spec}</span></span>
                          <span className="chev" aria-hidden="true" />
                        </span>
                      </td>
                      <td className="r">{p.kills}</td>
                      <td className={`r strong ${parseCss(p.parse)}`}>{p.parse ?? (p.role === 'tank' ? 'tank' : '–')}</td>
                      <td className={`r ${parseCss(p.best)}`}>{p.best ?? '–'}</td>
                      <td className={`r${p.deathsPerKill >= 0.5 ? ' warn-text' : ''}`}>{p.deaths}</td>
                      <td className="r">{p.activePct === null ? '–' : `${p.activePct}%`}</td>
                      <td className="r">{p.consumesPct === null ? '–' : `${p.consumesPct}%`}</td>
                      <td className="r">{p.attended} of {data.raids}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open && !data.high.includes(open) && !data.low.some((x) => x.name === open) && byName.has(open) && (
              <div className="perf-open"><PersonRow p={byName.get(open)!} open onClick={() => toggle(open)}><Drawer choice={choice} name={open} /></PersonRow></div>
            )}
            <p className="muted small">Active time and consumables come from the fights read in full. Click anyone to open their details.</p>
          </section>
        </>
      )}
    </>
  );
}

function Kpi({ glyph, label, value, sub, valueCls = '' }: { glyph: string; label: string; value: string; sub: string; valueCls?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><TileIcon glyph={glyph} />{label}</div>
      <div className={`kpi-value ${valueCls}`}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function PersonRow({ p, why, open, onClick, children }: { p: Perf['players'][number]; why?: string[]; open: boolean; onClick: () => void; children?: React.ReactNode }) {
  return (
    <div className={`perf-person${open ? ' open' : ''}`}>
      <button type="button" className="perf-person-head" aria-expanded={open} onClick={onClick}>
        <ClassIcon className={p.className} size={22} />
        <span className="perf-person-name">
          <strong className={`perf-link ${classCss(p.className)}`}>{p.name}</strong>
          <span className="muted small">{p.spec} · {p.kills} kill{p.kills === 1 ? '' : 's'}{p.deaths ? ` · died ${p.deaths === 1 ? 'once' : `${p.deaths} times`}` : ''}{why?.length ? ` · ${why.join('; ')}` : ''}</span>
        </span>
        <strong className={`perf-parse ${parseCss(p.parse)}`}>{p.parse ?? (p.role === 'tank' ? 'tank' : '–')}</strong>
        <span className="perf-more">{open ? 'Close' : 'Details'}<span className="chev" aria-hidden="true" /></span>
      </button>
      {children}
    </div>
  );
}

/** One person: the same message /performance character: sends, with who claimed them and the officer note. */
function Drawer({ choice, name }: { choice: PerfChoice; name: string }) {
  const [c, setC] = useState<PerformanceCharacter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dm, setDm] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadPerfCharacter(choice, name).then((x) => live && setC(x)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [name, choice.range, choice.host, choice.raid]);
  const send = async () => {
    setDm('Sending…');
    try {
      await sendPerfDm(choice, name);
      setDm('Sent to your Discord DMs.');
    } catch (e) {
      setDm((e as Error).message);
    }
  };
  return (
    <div className="perf-drawer">
      {error && <p className="error small">{error}</p>}
      {!c && !error && <p className="muted small"><span className="spinner small" aria-hidden="true" /> Reading their raids&hellip;</p>}
      {c && (
        <>
          <p className="small">
            {c.claimedBy ? <>Claimed by <strong>{c.claimedBy}</strong></> : <span className="muted">Not claimed by anyone yet</span>}
            {c.note && <> · <span className="perf-note">Officer note: {c.note}</span></>}
          </p>
          {c.embeds.map((e, i) => <EmbedView key={i} embed={e} />)}
          <div className="row wrap-center">
            {c.latestRaid && <a className="button ghost" href={`/#/me/raid?host=${encodeURIComponent(c.latestRaid.host)}&raid=${encodeURIComponent(c.latestRaid.code)}&character=${encodeURIComponent(name)}`}>Open their latest raid</a>}
            <button type="button" className="ghost" onClick={send}>Send me this as a DM</button>
            {dm && <span className="muted small">{dm}</span>}
          </div>
        </>
      )}
    </div>
  );
}
