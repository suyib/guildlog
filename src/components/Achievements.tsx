// Achievement banners, styled after the game's achievement pop-up: a badge, the name in gold and
// the points. Praise only.
import { useState } from 'react';
import type { Achievement } from '../achievements';
import { BossIcon, GameIcon } from './icons';

export default function Achievements({ list, title = 'Achievements', max = 4 }: { list: Achievement[]; title?: string; max?: number }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, max);
  return (
    <section className="achievements" aria-label={title}>
      {shown.map((a) => (
        <div key={a.key} className="ach">
          <span className="ach-badge">{a.bossId ? <BossIcon id={a.bossId} size="big" /> : <GameIcon file={a.icon ?? 'achievement_general'} size={52} />}</span>
          <div className="ach-text">
            <div className="ach-kind">{a.kind} achievement</div>
            <div className="ach-name">{a.name}</div>
            <div className="ach-sub">{a.sub}</div>
          </div>
          <span className="ach-points" title={`${a.points} points`}>{a.points}</span>
        </div>
      ))}
      {list.length > max && <button type="button" className="link-button small" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </section>
  );
}
