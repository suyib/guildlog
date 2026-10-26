// Rankings: the guild's ranks in each raid (progress and speed, world, region and realm) and each
// boss's guild rankings from Warcraft Logs, like Raider.IO's: by first kill or fastest kill.
import { useEffect, useState } from 'react';
import type { BossRanks, HomeData, WclRank, ZoneProgress } from '../../server/types';
import { loadBossRanks } from '../api';
import { mmss, n0 } from '../format';
import { RANK_CSS, ZonePicker, mainZone, useHome } from './Home';

/** Raid and boss from the link (#/rankings?zone=&boss=), when there is one. */
function fromLink(): { zone: number | null; boss: number | null } {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const n = (k: string) => (Number(q.get(k)) > 0 ? Number(q.get(k)) : null);
  return { zone: n('zone'), boss: n('boss') };
}

export default function RankingsPage() {
  const d = useHome();
  const [link] = useState(fromLink);
  const [zoneId, setZoneId] = useState<number | null>(link.zone);
  const [boss, setBoss] = useState<number | null>(link.boss);

  if (d === undefined) return <section className="panel home-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="muted">Loading rankings&hellip;</span></section>;
  if (!d || !d.zones.length) {
    return (
      <section className="panel">
        <h1>Rankings</h1>
        <p className="muted">Rankings show here once the guild has raids on Past raids.</p>
      </section>
    );
  }
  const zone = d.zones.find((z) => z.id === zoneId) ?? mainZone(d.zones, (z) => z.total);
  const picked = zone.bosses.find((b) => b.encounterId === boss) ?? zone.bosses[0];
  const pickZone = (id: number) => {
    setZoneId(id);
    setBoss(null);
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h1>Rankings</h1>
          <ZonePicker zones={d.zones} value={zone.id} onChange={pickZone} />
        </div>
        <p className="help">The guild&rsquo;s ranks from Warcraft Logs{d.wcl ? '' : ' (set WCL_GUILD_ID to see your own)'}, and every boss&rsquo;s top guilds by first kill or fastest kill.</p>
      </section>

      {zone.ranks && <RankCard key={zone.id} zones={[zone]} url={d.wcl?.url ?? null} />}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{zone.name} bosses</h2>
        </div>
        <div className="boss-picker" role="group" aria-label="Boss">
          {zone.bosses.map((b) => (
            <button key={b.encounterId} type="button" className={`ghost${picked?.encounterId === b.encounterId ? ' on' : ''}`} aria-pressed={picked?.encounterId === b.encounterId} onClick={() => setBoss(b.encounterId)}>
              {b.name}
            </button>
          ))}
        </div>
        {picked && <BossRankings key={`${zone.id}-${picked.encounterId}`} host={zone.host} zoneId={zone.id} encounterId={picked.encounterId} wcl={d.wcl} />}
      </section>
    </>
  );
}

const SCOPE_LABEL: Record<BossRanks['scope'], string> = { world: 'World', region: 'Region', realm: 'Realm' };
const killedAt = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A boss's guild rankings from Warcraft Logs, like Raider.IO's: by first kill or fastest kill, world, region or realm. */
function BossRankings({ host, zoneId, encounterId, wcl }: { host: string; zoneId: number; encounterId: number; wcl: HomeData['wcl'] }) {
  const [metric, setMetric] = useState<BossRanks['metric']>('progress');
  const [scope, setScope] = useState<BossRanks['scope']>('world');
  const [data, setData] = useState<BossRanks | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    loadBossRanks(host, encounterId, metric, scope).then((d) => live && setData(d)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [host, encounterId, metric, scope]);
  const scopes: BossRanks['scope'][] = wcl?.region ? (wcl.serverSlug ? ['world', 'region', 'realm'] : ['world', 'region']) : ['world'];
  const where = (r: BossRanks['top'][number]) => [r.server, r.region].filter(Boolean).join(' · ');
  return (
    <div className="boss-ranks">
      <div className="row wrap-center">
        <div className="seg" role="group" aria-label="Ranked by">
          <button type="button" className={metric === 'progress' ? 'on' : ''} aria-pressed={metric === 'progress'} onClick={() => setMetric('progress')}>First kill</button>
          <button type="button" className={metric === 'speed' ? 'on' : ''} aria-pressed={metric === 'speed'} onClick={() => setMetric('speed')}>Fastest</button>
        </div>
        {scopes.length > 1 && (
          <div className="seg" role="group" aria-label="Where">
            {scopes.map((x) => <button key={x} type="button" className={scope === x ? 'on' : ''} aria-pressed={scope === x} onClick={() => setScope(x)}>{x === 'region' && wcl?.region ? wcl.region : x === 'realm' && wcl?.server ? wcl.server : SCOPE_LABEL[x]}</button>)}
          </div>
        )}
        <a href={`https://${host}/zone/rankings/${zoneId}#boss=${encounterId}&metric=${metric}`} target="_blank" rel="noreferrer" className="small">On Warcraft Logs</a>
      </div>
      {error && <p className="error small">{error}</p>}
      {!data && !error && <p className="muted small"><span className="spinner small" aria-hidden="true" /> Loading rankings&hellip;</p>}
      {data && (
        <>
          <p className="small">
            {data.mine
              ? <>Your guild: <strong>#{n0(data.mine.rank)}</strong> {SCOPE_LABEL[data.scope].toLowerCase()}{data.metric === 'speed' && data.mine.seconds !== null ? ` (${mmss(data.mine.seconds)})` : ''}</>
              : <span className="muted">{data.checked ? `Your guild isn\u2019t in the top ${n0(data.checked)} yet.` : 'No kills ranked yet.'}</span>}
          </p>
          {data.top.length > 0 && (
            <table className="grid">
              <thead><tr><th className="r">#</th><th>Guild</th><th className="r">{data.metric === 'progress' ? 'Killed' : 'Time'}</th></tr></thead>
              <tbody>
                {data.top.map((r) => (
                  <tr key={`${r.rank}-${r.guild}`} className={r.mine ? 'mine' : ''}>
                    <td className="r">{r.rank}</td>
                    <td><strong>{r.guild}</strong> <span className="muted small">{where(r)}</span></td>
                    <td className="r muted">{data.metric === 'progress' ? (r.at ? killedAt(r.at) : '–') : r.seconds !== null ? mmss(r.seconds) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/** A raid's ranks, world rank big, with Progress and Speed tabs (links to Warcraft Logs). */
function RankCard({ zones, url }: { zones: ZoneProgress[]; url: string | null }) {
  const [zoneId, setZoneId] = useState(() => mainZone(zones, (z) => z.total).id);
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0];
  const [pick, setKind] = useState<'progress' | 'speed'>('progress');
  const kind = zone.ranks?.[pick] ? pick : pick === 'progress' ? 'speed' : 'progress';
  const set = zone.ranks?.[kind];
  const num = (r: WclRank | null | undefined) => (r ? <strong className={RANK_CSS[r.color ?? ''] ?? ''}>{n0(r.number)}</strong> : <strong className="muted">–</strong>);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{zones.length < 2 ? <>{zone.name} </> : 'Ranks '}<span className="muted">{zone.killed}/{zone.total}</span></h2>
        <ZonePicker zones={zones} value={zone.id} onChange={setZoneId} />
      </div>
      <div className="seg rank-kind" role="group" aria-label="Rank">
        <button type="button" className={kind === 'progress' ? 'on' : ''} aria-pressed={kind === 'progress'} onClick={() => setKind('progress')}>Progress</button>
        <button type="button" className={kind === 'speed' ? 'on' : ''} aria-pressed={kind === 'speed'} onClick={() => setKind('speed')}>Speed</button>
      </div>
      <a href={url ?? undefined} target="_blank" rel="noreferrer" className="rank-card">
        <span className="rank-world"><span className="muted small">World</span>{num(set?.world)}</span>
        <span className="rank-sub"><span className="muted small">Region</span>{num(set?.region)}</span>
        <span className="rank-sub"><span className="muted small">Realm</span>{num(set?.server)}</span>
      </a>
    </section>
  );
}
