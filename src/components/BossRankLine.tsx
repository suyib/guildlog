// Under a fight's title: a link to the boss's rankings and the guild's first-kill ranks for that boss,
// "#150 | #30 | #3", each with a tooltip (or "No ranking available").
import { useEffect, useState } from 'react';
import type { BossRanks } from '../../server/types';
import { loadBossRanks } from '../api';
import { n0 } from '../format';

const SCOPES: { scope: BossRanks['scope']; tip: string }[] = [
  { scope: 'world', tip: 'Worldwide first-kill rank' },
  { scope: 'region', tip: 'Region first-kill rank' },
  { scope: 'realm', tip: 'Realm first-kill rank' },
];

export default function BossRankLine({ host, encounterId, name }: { host: string; encounterId: number; name: string }) {
  // undefined: a rank that couldn't be read (signed out, or Warcraft Logs didn't answer)
  const [ranks, setRanks] = useState<(number | null | undefined)[] | null>(null);
  useEffect(() => {
    let live = true;
    setRanks(null);
    Promise.all(SCOPES.map((s) => loadBossRanks(host, encounterId, 'progress', s.scope).then((r) => r.mine?.rank ?? null).catch(() => undefined))).then((r) => live && setRanks(r));
    return () => {
      live = false;
    };
  }, [host, encounterId]);
  // Nothing for guests on a shared link (they can't open the Rankings page)
  if (ranks && ranks.every((r) => r === undefined)) return null;
  const shown = SCOPES.map((s, i) => ({ ...s, rank: ranks?.[i] ?? null })).filter((s) => s.rank);
  return (
    <div className="boss-rank-line">
      <a href={`/#/rankings?boss=${encounterId}`} title={`${name} rankings`}>Rankings</a>
      {!ranks ? <span className="muted">&hellip;</span> : !shown.length && <span className="muted">No ranking available</span>}
      {shown.length > 0 && <span>{shown.map((s, i) => (
        <span key={s.scope} className="rank-tip">
          {i > 0 && <span className="rank-sep" aria-hidden="true">|</span>}#{n0(s.rank!)}
          <span role="tooltip" className="rank-tip-text">{s.tip}</span>
        </span>
      ))}</span>}
    </div>
  );
}
