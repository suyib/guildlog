// Cast timeline, styled after Warcraft Logs' cast view: one row per player, a bar for every cast
// (auto attacks included) colored by ability, and a legend to show or hide abilities.
// Scroll to zoom, drag to pan, double-click to reset. Hovering a row shows what was cast at that
// moment and reveals when Bloodlust/Heroism and that player's big cooldowns were up.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BuffWindow, PlayerSnapshot } from '../../server/types';
import { mmss } from '../format';
import { classCss } from './icons';

const LABEL_W = 150;
const W = 760;
const PLOT_W = W - LABEL_W - 16;
const ROW_H = 40;
const TOP = 26;
/** How close (seconds) the pointer has to be to a cast for it to count as "that cast", at full zoom-out. */
const SNAP = 1.5;
const MIN_SPAN = 5;
const SLOTS = 7;

interface Row { label: string; snapshot: PlayerSnapshot }
interface Cast { t: number; name: string; auto?: boolean }
interface View { t0: number; t1: number }

/** Every cast for a row; older analyses only have unnamed, non-auto cast times. */
const castsOf = (s: PlayerSnapshot): Cast[] => s.casts ?? s.castSeconds.map((t) => ({ t, name: 'Cast' }));

/** A tidy tick step for the visible span. */
const tickStep = (span: number) => (span <= 12 ? 1 : span <= 25 ? 2 : span <= 60 ? 5 : span <= 150 ? 15 : span <= 320 ? 30 : 60);

export default function Timeline({ players }: { players: Row[] }) {
  const clipId = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const maxSec = Math.max(...players.map((p) => p.snapshot.fightSeconds), 1);
  const [view, setView] = useState<View>({ t0: 0, t1: maxSec });
  const [hover, setHover] = useState<{ row: number; t: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const drag = useRef<{ startX: number; view: View; moved: boolean } | null>(null);

  useEffect(() => setView({ t0: 0, t1: maxSec }), [maxSec]);

  // Colors follow the ability, most-cast first (your row first), the same in every row
  const legend = useMemo(() => {
    const counts = new Map<string, { count: number; auto: boolean }>();
    for (const p of players) for (const c of castsOf(p.snapshot)) {
      const e = counts.get(c.name) ?? { count: 0, auto: !!c.auto };
      e.count++;
      counts.set(c.name, e);
    }
    const sorted = [...counts].sort((a, b) => Number(a[1].auto) - Number(b[1].auto) || b[1].count - a[1].count);
    let slot = 0;
    return sorted.map(([name, { count, auto }]) => ({ name, count, cls: auto ? 'auto' : slot < SLOTS ? `slot-${++slot}` : 'slot-other' }));
  }, [players]);
  const colorOf = useMemo(() => new Map(legend.map((l) => [l.name, l.cls])), [legend]);

  const span = view.t1 - view.t0;
  const x = (t: number) => LABEL_W + ((t - view.t0) / span) * PLOT_W;
  const timeAt = (clientX: number) => {
    const box = svgRef.current!.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    return view.t0 + ((px - LABEL_W) / PLOT_W) * span;
  };
  const clampView = (t0: number, t1: number): View => {
    let s = Math.max(MIN_SPAN, Math.min(maxSec, t1 - t0));
    let a = Math.max(0, Math.min(maxSec - s, t0));
    if (s >= maxSec) { a = 0; s = maxSec; }
    return { t0: a, t1: a + s };
  };

  // Scroll to zoom around the cursor. Added by hand so the page doesn't scroll at the same time.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = timeAt(e.clientX);
      const factor = e.deltaY < 0 ? 1 / 1.25 : 1.25;
      setView((v) => {
        const s = (v.t1 - v.t0) * factor;
        const ratio = (t - v.t0) / (v.t1 - v.t0);
        return clampView(t - ratio * s, t - ratio * s + s);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const step = tickStep(span);
  const ticks: number[] = [];
  for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1 + 0.001; t += step) ticks.push(t);
  const h = TOP + players.length * ROW_H + 4;
  const zoomed = span < maxSec - 0.01;
  const snap = Math.max(0.25, SNAP * (span / maxSec));

  const hovered = hover ? players[hover.row] : null;
  const info = hovered && hover ? describe(hovered, hover.t, snap, hidden) : null;

  return (
    <div className="timeline-wrap">
      <div className="tl-legend" role="group" aria-label="Show or hide abilities">
        {legend.map((l) => (
          <button
            key={l.name}
            type="button"
            className={hidden.has(l.name) ? 'tl-chip off' : 'tl-chip'}
            aria-pressed={!hidden.has(l.name)}
            onClick={() => setHidden((hs) => {
              const next = new Set(hs);
              if (next.has(l.name)) next.delete(l.name);
              else next.add(l.name);
              return next;
            })}
          >
            <span className={`swatch ${l.cls}`} aria-hidden="true" />
            {l.name}
            <span className="tl-count">{l.count}</span>
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${h}`}
        className={zoomed ? 'timeline zoomed' : 'timeline'}
        role="img"
        aria-label="Cast timeline per player"
        onPointerDown={(e) => {
          drag.current = { startX: e.clientX, view, moved: false };
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const box = svgRef.current!.getBoundingClientRect();
          const dt = ((e.clientX - d.startX) / box.width) * W * ((d.view.t1 - d.view.t0) / PLOT_W);
          if (Math.abs(e.clientX - d.startX) > 3) d.moved = true;
          if (d.moved) setView(clampView(d.view.t0 - dt, d.view.t1 - dt));
        }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => setView({ t0: 0, t1: maxSec })}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={LABEL_W} y={0} width={PLOT_W} height={h} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={18} y2={h} className="grid" />)}
        </g>
        {/* Labels sit outside the clip so the first and last aren't cut in half */}
        {ticks.map((t) => <text key={t} x={x(t)} y={12} textAnchor="middle" className="tick">{mmss(t)}</text>)}

        {players.map((p, i) => {
          const y = TOP + i * ROW_H;
          const isHovered = hover?.row === i;
          const baseline = y + ROW_H - 8;
          return (
            <g key={p.label} className={isHovered ? 'row on' : 'row'}>
              <text x={0} y={y + ROW_H / 2 + 2} className={`name ${classCss(p.snapshot.className)}-fill${i === 0 ? ' me' : ''}`}>
                {p.label.length > 22 ? p.label.slice(0, 21) + '…' : p.label}
              </text>
              <line x1={LABEL_W} x2={LABEL_W + PLOT_W} y1={baseline} y2={baseline} className="baseline" />
              <g clipPath={`url(#${clipId})`}>
                {isHovered && (p.snapshot.windows ?? []).map((w, j) =>
                  w.kind === 'lust'
                    // Bloodlust: a band over the whole row; cooldowns: a bar under the casts, so overlaps stay readable
                    ? <rect key={`w${j}`} x={x(w.start)} y={y} width={Math.max(1, x(w.end) - x(w.start))} height={ROW_H - 6} className="win-lust" />
                    : <rect key={`w${j}`} x={x(w.start)} y={baseline + 1} width={Math.max(1, x(w.end) - x(w.start))} height={4} rx={2} className="win-cd" />,
                )}
                {p.snapshot.gaps.map((g, j) => (
                  <rect key={j} x={x(g.start)} y={y + 2} width={Math.max(1, x(g.end) - x(g.start))} height={baseline - y - 2} className="gap" />
                ))}
                {castsOf(p.snapshot)
                  .filter((c) => c.t >= view.t0 - 1 && c.t <= view.t1 + 1 && !hidden.has(c.name))
                  .map((c, j) => (
                    // Auto attacks are shorter bars so your own casts stand out
                    <line key={j} x1={x(c.t)} x2={x(c.t)} y1={c.auto ? baseline - 12 : y + 4} y2={baseline} className={`cast ${colorOf.get(c.name) ?? 'slot-other'}`} />
                  ))}
                {p.snapshot.cooldowns.flatMap((c) => c.times.map((t, j) => (
                  <circle key={`${c.name}-${j}`} cx={x(t)} cy={y + 4} r={3.5} className="cd" />
                )))}
                {isHovered && hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={y - 2} y2={baseline + 6} className="hover-line" />}
              </g>
              <rect
                x={LABEL_W}
                y={y - 2}
                width={PLOT_W}
                height={ROW_H}
                fill="transparent"
                onPointerMove={(e) => setHover({ row: i, t: Math.max(0, Math.min(maxSec, timeAt(e.clientX))) })}
                onPointerLeave={() => setHover(null)}
              />
            </g>
          );
        })}

        {/* Drawn last so it sits on top; the SVG lets it spill outside its box (see .timeline in theme.css) */}
        {hover && info && <Tip x={x(hover.t)} rowTop={TOP + hover.row * ROW_H} who={players.length > 1 ? hovered!.label : null} info={info} />}
      </svg>

      <div className="tl-help">
        <span className="muted small">Scroll on the timeline to zoom, drag to move, double-click to reset. Click an ability above to hide or show it.</span>
        {zoomed && <button type="button" className="ghost" onClick={() => setView({ t0: 0, t1: maxSec })}>Reset zoom</button>}
      </div>

      {/* Same information for screen readers */}
      <p className="sr-only" aria-live="polite">
        {info ? `${mmss(info.t)}: ${info.casts.join(', ') || info.empty}. ${info.active.map((w) => `${w.name} up`).join(', ')}` : ''}
      </p>
    </div>
  );
}

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

/** What was cast near this moment (hidden abilities left out), and which windows were active. */
function describe(p: Row, t: number, snap: number, hidden: Set<string>): Info {
  const near = castsOf(p.snapshot)
    .filter((c) => !hidden.has(c.name) && Math.abs(c.t - t) <= snap)
    .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t));
  let names: string[] = [];
  let at = t;
  if (near.length) {
    at = near[0].t;
    // Casts in the same instant (an instant spell plus a cooldown, say) are listed together
    names = near.filter((c) => Math.abs(c.t - at) <= Math.min(0.3, snap)).map((c) => (c.auto ? `${c.name} (auto)` : c.name));
  }
  const active = (p.snapshot.windows ?? []).filter((w) => at >= w.start && at <= w.end);
  const inGap = p.snapshot.gaps.some((g) => t >= g.start && t <= g.end);
  return { t: at, casts: Array.from(new Set(names)).slice(0, 6), active, empty: inGap ? 'No casts (gap)' : 'No cast here' };
}
