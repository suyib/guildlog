// Rankings: the guild's ranks in each raid (progress and speed, world, region and realm) and each
// boss's guild rankings from Warcraft Logs, like Raider.IO's: by first kill or fastest kill.
import { useEffect, useState } from 'react';
import type { BossRanks, HomeData, SavedRaid, WclRank, ZoneProgress } from '../../server/types';
import { loadBossRanks, loadRaids } from '../api';
import { mmss, n0 } from '../format';
import { RANK_CSS, ZonePicker, mainZone, useHome } from './Home';
import { BossIcon } from './icons';
import { go, hashParam } from '../url';

/** Raid and boss from the address (#/rankings?zone=&boss=), when there is one. */
function fromLink(): { zone: number | null; boss: number | null } {
  const n = (k: string) => (Number(hashParam(k)) > 0 ? Number(hashParam(k)) : null);
  return { zone: n('zone'), boss: n('boss') };
}

/** Each choice gets its own address, so it can be shared and Back returns to the one before. */
const show = (zone: number, boss: number | null) => go(`/#/rankings?zone=${zone}${boss ? `&boss=${boss}` : ''}`);

export default function RankingsPage() {
  const d = useHome();
  const [link] = useState(fromLink);
  const [zoneId, setZoneId] = useState<number | null>(link.zone);
  /** null: the whole raid. */
  const [boss, setBoss] = useState<number | null>(link.boss);
  // Past raids, to list the ones in the chosen raid zone under the ranks
  const [raids, setRaids] = useState<SavedRaid[] | null>(null);
  useEffect(() => {
    loadRaids().then((r) => setRaids(r.raids)).catch(() => setRaids([]));
  }, []);

  if (d === undefined) return <section className="panel home-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="muted">Loading rankings&hellip;</span></section>;
  if (!d || !d.zones.length) {
    return (
      <section className="panel">
        <h1>Rankings</h1>
        <p className="muted">Rankings show here once the guild has raids on Past raids.</p>
      </section>
    );
  }
  // A link to a boss without its raid: the raid it's in
  const zone = d.zones.find((z) => z.id === zoneId) ?? d.zones.find((z) => boss && z.bosses.some((b) => b.encounterId === boss)) ?? mainZone(d.zones, (z) => z.total);
  const picked = zone.bosses.find((b) => b.encounterId === boss) ?? null;
  const pickZone = (id: number) => {
    setZoneId(id);
    setBoss(null);
    show(id, null);
  };
  const pickBoss = (id: number | null) => {
    setBoss(id);
    show(zone.id, id);
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h1>Rankings</h1>
          <div className="row wrap-center">
            <ZonePicker zones={d.zones} value={zone.id} onChange={pickZone} />
            <select value={picked?.encounterId ?? ''} onChange={(e) => pickBoss(e.target.value ? Number(e.target.value) : null)} aria-label="Whole raid or one boss">
              <option value="">Whole raid</option>
              {zone.bosses.map((b) => <option key={b.encounterId} value={b.encounterId}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <p className="help">The guild&rsquo;s ranks from Warcraft Logs{d.wcl ? '' : ' (set WCL_GUILD_ID to see your own)'}: the whole raid, or one boss&rsquo;s top guilds by first kill or fastest kill.</p>
      </section>

      {picked ? (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title with-icon"><BossIcon id={picked.encounterId} size="small" />{picked.name}</h2>
          </div>
          <BossRankings key={`${zone.id}-${picked.encounterId}`} host={zone.host} zoneId={zone.id} encounterId={picked.encounterId} wcl={d.wcl} />
        </section>
      ) : (
        <RankCard key={zone.id} zone={zone} url={d.wcl?.url ?? null} />
      )}

      <ZoneRaids zone={zone} boss={picked ? { id: picked.encounterId, name: picked.name } : null} raids={raids} />
    </>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
const logLink = (r: SavedRaid, fightId?: number | null) => `/?log=${encodeURIComponent(`https://${r.host}/reports/${r.code}${fightId ? `?fight=${fightId}` : ''}`)}`;

/**
 * Every uploaded raid in this zone, newest first, each opening its breakdown. With a boss picked:
 * the raids it was fought in, with the kill time, each opening that fight.
 */
function ZoneRaids({ zone, boss, raids }: { zone: ZoneProgress; boss: { id: number; name: string } | null; raids: SavedRaid[] | null }) {
  const ids = new Set(zone.bosses.map((b) => b.encounterId));
  const list = (raids ?? [])
    .filter((r) => r.startTime && r.card?.bosses.some((b) => (boss ? b.encounterId === boss.id : ids.has(b.encounterId))))
    .sort((a, b) => b.startTime!.localeCompare(a.startTime!));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{boss ? `${boss.name} in past raids` : `${zone.name} raids`}{raids ? ` (${list.length})` : ''}</h2>
        <a href="/#/raids" className="small">Past raids</a>
      </div>
      {!raids ? (
        <p className="muted small"><span className="spinner small" aria-hidden="true" /> Loading raids&hellip;</p>
      ) : !list.length ? (
        <p className="muted small">No uploaded raids {boss ? 'with this boss' : 'in this zone'} yet.</p>
      ) : (
        <ul className="home-raids">
          {list.map((r) => {
            const c = r.card!;
            if (boss) {
              const b = c.bosses.find((x) => x.encounterId === boss.id)!;
              return (
                <li key={r.code}>
                  <span className={`raid-chip-count ${b.kill ? 'full' : 'none'}`}>{b.kill ? 'Kill' : 'Wipe'}</span>
                  <span className="home-raid-main">
                    <a href={logLink(r, b.fightId)}><strong>{r.title ?? r.code}</strong></a>
                    <span className="muted small">
                      {longDate(r.startTime!)}{b.kill && b.seconds ? ` \u00b7 killed in ${mmss(b.seconds)}` : ''}{b.wipes ? ` \u00b7 ${b.wipes} wipe${b.wipes === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                </li>
              );
            }
            const full = c.kills > 0 && c.bosses.every((b) => b.kill);
            return (
              <li key={r.code}>
                <span className={`raid-chip-count ${full ? 'full' : c.kills ? 'partial' : 'none'}`}>{c.kills}/{c.bosses.length}</span>
                <span className="home-raid-main">
                  <a href={logLink(r)}><strong>{r.title ?? r.code}</strong></a>
                  <span className="muted small">
                    {[
                      longDate(r.startTime!),
                      c.raidSeconds ? hm(c.raidSeconds) : null,
                      `${c.raiders.length} raiders`,
                      `${c.wipes} wipe${c.wipes === 1 ? '' : 's'}`,
                      `${c.deaths} death${c.deaths === 1 ? '' : 's'} on kills`,
                      c.avgItemLevel ? `item level ${c.avgItemLevel}` : null,
                      r.loggerName ? `logged by ${r.loggerName}` : null,
                    ].filter(Boolean).join(' \u00b7 ')}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
function RankCard({ zone, url }: { zone: ZoneProgress; url: string | null }) {
  const [kind, setKind] = useState<'progress' | 'speed'>('progress');
  const set = zone.ranks?.[kind];
  const any = !!set && !!(set.world || set.region || set.server);
  const num = (r: WclRank | null | undefined) => (r ? <strong className={RANK_CSS[r.color ?? ''] ?? ''}>{n0(r.number)}</strong> : <strong className="muted">–</strong>);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{zone.name} <span className="muted">{zone.killed}/{zone.total}</span></h2>
        <div className="seg" role="group" aria-label="Rank">
          <button type="button" className={kind === 'progress' ? 'on' : ''} aria-pressed={kind === 'progress'} onClick={() => setKind('progress')}>Progress</button>
          <button type="button" className={kind === 'speed' ? 'on' : ''} aria-pressed={kind === 'speed'} onClick={() => setKind('speed')}>Speed</button>
        </div>
      </div>
      {any ? (
        <a href={url ?? undefined} target="_blank" rel="noreferrer" className="rank-card">
          <span className="rank-world"><span className="muted small">World</span>{num(set?.world)}</span>
          <span className="rank-sub"><span className="muted small">Region</span>{num(set?.region)}</span>
          <span className="rank-sub"><span className="muted small">Realm</span>{num(set?.server)}</span>
        </a>
      ) : (
        <p className="muted">
          {url ? `No ${kind} rank on Warcraft Logs for this raid yet.` : 'Set WCL_GUILD_ID in Vercel to see the guild\u2019s ranks.'} Pick a boss above for its top guilds.
        </p>
      )}
    </section>
  );
}
