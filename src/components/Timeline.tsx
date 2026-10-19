import type { PlayerSnapshot } from '../../server/types';
import { mmss } from '../format';

const LABEL_W = 150;
const W = 760;
const ROW_H = 34;

export default function Timeline({ players }: { players: { label: string; snapshot: PlayerSnapshot }[] }) {
  const maxSec = Math.max(...players.map((p) => p.snapshot.fightSeconds), 1);
  const x = (s: number) => LABEL_W + (s / maxSec) * (W - LABEL_W - 16);
  const step = maxSec > 300 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(maxSec / step) + 1 }, (_, i) => i * step);
  const h = 28 + players.length * ROW_H;

  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="timeline" role="img" aria-label="Cast timeline per player">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={18} y2={h} className="grid" />
          <text x={x(t)} y={12} textAnchor="middle" className="tick">{mmss(t)}</text>
        </g>
      ))}
      {players.map((p, i) => {
        const y = 24 + i * ROW_H;
        return (
          <g key={p.label}>
            <text x={0} y={y + 16} className={i === 0 ? 'name me' : 'name'}>{p.label.length > 22 ? p.label.slice(0, 21) + '…' : p.label}</text>
            {p.snapshot.gaps.map((g, j) => (
              <rect key={j} x={x(g.start)} y={y + 2} width={Math.max(1, x(g.end) - x(g.start))} height={ROW_H - 10} className="gap" />
            ))}
            {p.snapshot.castSeconds.map((t, j) => (
              <line key={j} x1={x(t)} x2={x(t)} y1={y + 4} y2={y + ROW_H - 10} className={i === 0 ? 'cast me' : 'cast'} />
            ))}
            {p.snapshot.cooldowns.flatMap((c) => c.times.map((t, j) => (
              <circle key={`${c.name}-${j}`} cx={x(t)} cy={y + ROW_H - 6} r={3.5} className="cd">
                <title>{`${c.name} at ${mmss(t)}`}</title>
              </circle>
            )))}
          </g>
        );
      })}
    </svg>
  );
}
