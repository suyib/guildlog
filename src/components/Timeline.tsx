// Cast timeline: one row per player. Hovering a row shows what was cast at that moment, and
// reveals when Bloodlust/Heroism and that player's big cooldowns were up.
import { useState } from 'react';
import type { BuffWindow, PlayerSnapshot } from '../../server/types';
import { mmss } from '../format';
import { classCss } from './icons';

const LABEL_W = 150;
const W = 760;
const ROW_H = 34;
/** How close (seconds) the pointer has to be to a cast for it to count as "that cast". */
const SNAP = 1.5;

interface Row { label: string; snapshot: PlayerSnapshot }

export default function Timeline({ players }: { players: Row[] }) {
  const [hover, setHover] = useState<{ row: number; t: number; cursor: number } | null>(null);
  const maxSec = Math.max(...players.map((p) => p.snapshot.fightSeconds), 1);
  const x = (s: number) => LABEL_W + (s / maxSec) * (W - LABEL_W - 16);
  const step = maxSec > 300 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(maxSec / step) + 1 }, (_, i) => i * step);
  const h = 28 + players.length * ROW_H;

  function onMove(row: number, e: React.PointerEvent<SVGRectElement>) {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const t = ((px - LABEL_W) / (W - LABEL_W - 16)) * maxSec;
    const clamped = Math.max(0, Math.min(maxSec, t));
    setHover({ row, t: clamped, cursor: clamped });
  }

  const hovered = hover ? players[hover.row] : null;
  const readout = hovered && hover ? describe(hovered, hover.t) : null;

  return (
    <div className="timeline-wrap">
      <svg viewBox={`0 0 ${W} ${h}`} className="timeline" role="img" aria-label="Cast timeline per player">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={18} y2={h} className="grid" />
            <text x={x(t)} y={12} textAnchor="middle" className="tick">{mmss(t)}</text>
          </g>
        ))}
        {players.map((p, i) => {
          const y = 24 + i * ROW_H;
          const isHovered = hover?.row === i;
          return (
            <g key={p.label} className={isHovered ? 'row on' : 'row'}>
              <text x={0} y={y + 16} className={`name ${classCss(p.snapshot.className)}-fill${i === 0 ? ' me' : ''}`}>{p.label.length > 22 ? p.label.slice(0, 21) + '…' : p.label}</text>
              {/* Bloodlust and cooldown windows: only while this row is hovered */}
              {isHovered && (p.snapshot.windows ?? []).map((w, j) => (
                w.kind === 'lust'
                  // Bloodlust: a band over the whole row; cooldowns: a bar along the bottom, so overlaps stay readable
                  ? <rect key={`w${j}`} x={x(w.start)} y={y} width={Math.max(1, x(w.end) - x(w.start))} height={ROW_H - 6} className="win-lust" />
                  : <rect key={`w${j}`} x={x(w.start)} y={y + ROW_H - 12} width={Math.max(1, x(w.end) - x(w.start))} height={4} rx={2} className="win-cd" />
              ))}
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
              {isHovered && hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={y - 2} y2={y + ROW_H - 4} className="hover-line" />}
              <rect
                x={LABEL_W}
                y={y - 2}
                width={W - LABEL_W - 16}
                height={ROW_H}
                fill="transparent"
                onPointerMove={(e) => onMove(i, e)}
                onPointerLeave={() => setHover(null)}
              />
            </g>
          );
        })}
        {/* Drawn last so it sits on top; the SVG lets it spill outside its box (see .timeline in theme.css) */}
        {hover && readout && <Tip x={x(hover.cursor)} rowTop={24 + hover.row * ROW_H} who={players.length > 1 ? hovered!.label : null} info={readout} />}
      </svg>
      {/* Same information for screen readers */}
      <p className="sr-only" aria-live="polite">
        {readout ? `${mmss(readout.t)}: ${readout.casts.join(', ') || readout.empty}. ${readout.active.map((w) => `${w.name} up`).join(', ')}` : ''}
      </p>
    </div>
  );
}

/** What was cast near this moment, and which windows were active. */
interface Info { t: number; casts: string[]; active: BuffWindow[]; empty: string }

/** Tooltip next to the cursor: time, what was cast, and any Bloodlust or cooldown windows up at that moment. */
function Tip({ x, rowTop, who, info }: { x: number; rowTop: number; who: string | null; info: Info }) {
  const lines: { text: string; cls: string }[] = [{ text: who ? `${mmss(info.t)} · ${who}` : mmss(info.t), cls: 'tip-time' }];
  if (info.casts.length) for (const c of info.casts) lines.push({ text: c, cls: 'tip-cast' });
  else lines.push({ text: info.empty, cls: 'tip-empty' });
  for (const w of info.active) lines.push({ text: `${w.name}  ${mmss(w.start)}–${mmss(w.end)}`, cls: w.kind === 'lust' ? 'tip-lust' : 'tip-cd' });
  const lineH = 15;
  const w = Math.max(90, ...lines.map((l) => l.text.length * 6.4)) + 18;
  const h = 10 + lines.length * lineH;
  const left = x + 12 + w > W ? x - 12 - w : x + 12;
  // Centered on the row, beside the cursor, so it covers as little of the page around it as possible
  const top = rowTop + (ROW_H - 6) / 2 - h / 2;
  return (
    <g className="timeline-tip" transform={`translate(${left.toFixed(1)},${top.toFixed(1)})`} pointerEvents="none">
      <rect width={w} height={h} rx={6} />
      {lines.map((l, i) => (
        <text key={i} x={9} y={17 + i * lineH} className={l.cls}>{l.text}</text>
      ))}
    </g>
  );
}

function describe(p: Row, t: number): Info {
  const casts = p.snapshot.casts;
  let names: string[] = [];
  let at = t;
  if (casts?.length) {
    const near = casts.filter((c) => Math.abs(c.t - t) <= SNAP).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t));
    if (near.length) {
      at = near[0].t;
      // Casts in the same instant (an instant spell plus a cooldown, say) are listed together
      names = near.filter((c) => Math.abs(c.t - at) <= 0.3).map((c) => c.name);
    }
  } else {
    const nearest = p.snapshot.castSeconds.find((c) => Math.abs(c - t) <= SNAP);
    if (nearest !== undefined) {
      at = nearest;
      names = ['A cast (analyze again to see names)'];
    }
  }
  const active = (p.snapshot.windows ?? []).filter((w) => at >= w.start && at <= w.end);
  const inGap = p.snapshot.gaps.some((g) => t >= g.start && t <= g.end);
  return { t: at, casts: Array.from(new Set(names)).slice(0, 5), active, empty: inGap ? 'No casts (gap)' : 'No cast within 1.5s' };
}
