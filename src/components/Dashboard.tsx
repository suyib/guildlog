// "Just my stats": a personal dashboard for one player's fight, shown when nothing is compared.
import { useMemo, useState } from 'react';
import type { AbilityRow, AnalysisResult, GearItem, PlayerSnapshot } from '../../server/types';
import { compact, mmss, n0, pct } from '../format';
import { BlankIcon, GameIcon, SeverityDot } from './icons';
import Timeline from './Timeline';

/** Damage breakdown slices. Their colors are .slot-1 … .slot-7 and .slot-other in theme.css. */
const MAX_SLICES = 7;

const QUALITY = ['q-poor', 'q-common', 'q-uncommon', 'q-rare', 'q-epic', 'q-legendary', 'q-artifact', 'q-heirloom'];

export default function Dashboard({ result }: { result: AnalysisResult }) {
  const me = result.player;
  const d = result.dashboard;
  const lust = me.buffs.find((b) => b.name === 'Bloodlust' || b.name === 'Heroism');
  const gapTotal = Math.round(me.gaps.reduce((t, g) => t + g.seconds, 0));
  const ownBuffs = me.buffs.filter((b) => b.uptimePct >= 5).sort((a, b) => b.uptimePct - a.uptimePct).slice(0, 14);

  return (
    <>
      <section className="panel">
        <h3 className="panel-title">Fight at a glance</h3>
        <div className="tiles">
          <Tile label="Damage done" value={compact(me.total)} />
          <Tile label="DPS" value={n0(me.dps)} />
          <Tile label="Active time" value={pct(me.activePct)} />
          <Tile label="Time with no casts" value={`${gapTotal}s`} />
          <Tile label="Casts" value={n0(me.castSeconds.length)} />
          <Tile label="Bloodlust uptime" value={lust ? pct(lust.uptimePct) : '–'} />
          <Tile label="Deaths" value={String(me.deaths.length)} />
          <Tile label="Damage taken" value={compact(me.damageTaken.reduce((t, x) => t + x.total, 0))} />
        </div>
        {result.findings.length > 0 && (
          <ul className="findings dash-findings">
            {result.findings.map((f, i) => (
              <li key={i} className={`sev-${f.severity}`}>
                <SeverityDot severity={f.severity} />
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {result.notes.length > 0 && <p className="muted small">Notes: {result.notes.join(' · ')}</p>}
      </section>

      <div className="dash-grid">
        <section className="panel">
          <h3 className="panel-title">DPS over the fight</h3>
          {d && d.dpsSeries.length > 1 ? (
            <DpsChart series={d.dpsSeries} average={me.dps} snapshot={me} />
          ) : (
            <p className="muted small">Warcraft Logs didn&rsquo;t return a damage graph for this fight.</p>
          )}
        </section>

        <section className="panel">
          <h3 className="panel-title">Damage by ability</h3>
          <DamageDonut abilities={me.abilities} total={me.total} />
        </section>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <h3 className="panel-title">Gear</h3>
          {d && d.gear.length > 0 ? <GearTable gear={d.gear} /> : <p className="muted small">No gear data in this log.</p>}
        </section>

        <section className="panel">
          <h3 className="panel-title">Stats at the pull</h3>
          {d && d.stats.length > 0 ? (
            <dl className="stat-list">
              {d.stats.map((s) => (
                <div key={s.name}>
                  <dt>{s.name}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted small">No stats in this log. Warcraft Logs only records them when the logger saw you at the pull.</p>
          )}
        </section>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <h3 className="panel-title">Cooldowns</h3>
          {me.cooldowns.length === 0 ? (
            <p className="muted small">No tracked cooldowns for this class yet.</p>
          ) : (
            <table className="grid">
              <thead><tr><th>Cooldown</th><th className="r">Used / possible</th><th>When</th></tr></thead>
              <tbody>
                {me.cooldowns.map((c) => (
                  <tr key={c.name} className={c.uses < c.possible ? 'warn' : ''}>
                    <td><span className="with-icon"><GameIcon file={c.icon} />{c.name}</span></td>
                    <td className="r">{c.uses} / {c.possible}</td>
                    <td className="muted small">{c.times.length ? c.times.map(mmss).join(', ') : 'not used'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h3 className="panel-title">Buff uptime</h3>
          {ownBuffs.length === 0 ? (
            <p className="muted small">No buffs recorded.</p>
          ) : (
            <table className="grid">
              <tbody>
                {ownBuffs.map((b) => (
                  <tr key={b.name}>
                    <td><span className="with-icon"><GameIcon file={b.icon} />{b.name}</span></td>
                    <td className="r">
                      <span className="uptime">
                        <progress className="bar uptime-bar" max={100} value={Math.min(100, b.uptimePct)} aria-hidden="true" />
                        {pct(b.uptimePct)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel">
        <h3 className="panel-title">Cast timeline</h3>
        <p className="muted small">Each tick is a cast (auto attacks excluded). Red bands are gaps over 4 seconds; yellow dots are major cooldowns.</p>
        <Timeline players={[{ label: 'You', snapshot: me }]} />
      </section>

      {(me.deaths.length > 0 || me.damageTaken.length > 0) && (
        <section className="panel">
          <h3 className="panel-title">Deaths and damage taken</h3>
          {me.deaths.length > 0 && (
            <p>
              {me.deaths.map((x, i) => (
                <span key={i} className="death">Died at {mmss(x.seconds)}{x.by ? ` to ${x.by}` : ''}</span>
              ))}
            </p>
          )}
          {me.damageTaken.length > 0 && (
            <table className="grid">
              <thead><tr><th>Source</th><th className="r">Damage taken</th></tr></thead>
              <tbody>
                {me.damageTaken.slice(0, 8).map((x) => (
                  <tr key={x.name}><td>{x.name}</td><td className="r">{compact(x.total)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

// ---------- DPS over time ----------

function DpsChart({ series, average, snapshot }: { series: { t: number; dps: number }[]; average: number; snapshot: PlayerSnapshot }) {
  const W = 640;
  const H = 240;
  const pad = { l: 52, r: 12, t: 22, b: 26 };
  const [hover, setHover] = useState<number | null>(null);

  const tMax = Math.max(series[series.length - 1].t, 1);
  const yMax = niceMax(Math.max(...series.map((p) => p.dps), average));
  const x = (t: number) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.dps).toFixed(1)}`).join('');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xStep = tMax > 300 ? 60 : tMax > 120 ? 30 : 15;
  const xTicks = Array.from({ length: Math.floor(tMax / xStep) + 1 }, (_, i) => i * xStep);
  const cds = snapshot.cooldowns.flatMap((c) => c.times.map((t) => ({ t, name: c.name })));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width * W - pad.l) / (W - pad.l - pad.r) * tMax;
    let best = 0;
    for (let i = 1; i < series.length; i++) if (Math.abs(series[i].t - t) < Math.abs(series[best].t - t)) best = i;
    setHover(best);
  }

  const hp = hover === null ? null : series[hover];
  const nearCds = hp ? cds.filter((c) => Math.abs(c.t - hp.t) <= Math.max(3, tMax / 60)) : [];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`DPS over the fight, averaging ${n0(average)}`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pad.l - 8} y={y(v) + 4} textAnchor="end">{compact(v)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} className="axis" x={x(t)} y={H - 8} textAnchor="middle">{mmss(t)}</text>
        ))}
        {cds.map((c, i) => (
          <line key={i} className="cd-mark" x1={x(c.t)} x2={x(c.t)} y1={pad.t - 6} y2={H - pad.b}>
            <title>{`${c.name} at ${mmss(c.t)}`}</title>
          </line>
        ))}
        <line className="avg-line" x1={pad.l} x2={W - pad.r} y1={y(average)} y2={y(average)} />
        <text className="avg-label" x={W - pad.r} y={y(average) - 6} textAnchor="end">Average {n0(average)}</text>
        <path className="dps-line" d={line} />
        {hp && (
          <>
            <line className="crosshair" x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={H - pad.b} />
            <circle className="dps-dot" cx={x(hp.t)} cy={y(hp.dps)} r={4.5} />
          </>
        )}
        {hp && <ChartTip x={x(hp.t)} y={y(hp.dps)} W={W} lines={[mmss(hp.t), `${n0(hp.dps)} DPS`, ...nearCds.map((c) => c.name)]} />}
        <rect
          x={pad.l}
          y={pad.t}
          width={W - pad.l - pad.r}
          height={H - pad.t - pad.b}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <p className="muted small chart-key">
        <span className="key-line" /> DPS, smoothed <span className="key-dash" /> fight average <span className="key-cd" /> cooldown used
      </p>
    </div>
  );
}

/** Hover tooltip drawn inside the SVG, flipped to stay inside the chart. */
function ChartTip({ x, y, W, lines }: { x: number; y: number; W: number; lines: string[] }) {
  const w = Math.max(88, ...lines.map((l) => l.length * 7)) + 16;
  const h = 10 + lines.length * 16;
  const left = Math.min(Math.max(x - w / 2, 4), W - w - 4);
  const top = y - h - 12 < 2 ? y + 12 : y - h - 12;
  return (
    <g className="chart-tip" transform={`translate(${left.toFixed(1)},${top.toFixed(1)})`} pointerEvents="none">
      <rect width={w} height={h} rx={8} />
      {lines.map((l, i) => (
        <text key={i} x={8} y={18 + i * 16} className={i === 1 ? 'tip-value' : 'tip-label'}>{l}</text>
      ))}
    </g>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

// ---------- Damage breakdown donut ----------

interface Slice { key: string; name: string; total: number; share: number; slot: string; icon?: string; casts?: number; isPet?: boolean; count?: number }

function DamageDonut({ abilities, total }: { abilities: AbilityRow[]; total: number }) {
  const [active, setActive] = useState<string | null>(null);
  const slices = useMemo<Slice[]>(() => {
    const sorted = [...abilities].filter((a) => a.total > 0).sort((a, b) => b.total - a.total);
    const sum = total || sorted.reduce((t, a) => t + a.total, 0) || 1;
    // A separate "Other" only when it would hold two or more abilities
    const head = sorted.length > MAX_SLICES + 1 ? sorted.slice(0, MAX_SLICES) : sorted.slice(0, MAX_SLICES + 1);
    const rest = sorted.slice(head.length);
    const out: Slice[] = head.map((a, i) => ({
      key: `${a.name}-${a.id}`,
      name: a.isPet ? `${a.name} (pet)` : a.name,
      total: a.total,
      share: a.total / sum,
      slot: `slot-${i + 1}`,
      icon: a.isPet ? 'ability_hunter_pet_cat' : a.icon,
      casts: a.casts,
      isPet: a.isPet,
    }));
    if (rest.length) {
      const t = rest.reduce((s, a) => s + a.total, 0);
      out.push({ key: 'other', name: `Other (${rest.length} abilities)`, total: t, share: t / sum, slot: 'slot-other', count: rest.length });
    }
    return out;
  }, [abilities, total]);

  if (!slices.length) return <p className="muted small">No damage recorded.</p>;

  const R = 92;
  const r = 58;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const a0 = angle;
    const a1 = angle + s.share * Math.PI * 2;
    angle = a1;
    return { s, d: arcPath(100, 100, R, r, a0, Math.min(a1, a0 + Math.PI * 2 - 1e-4)) };
  });
  const shown = slices.find((s) => s.key === active) ?? null;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 200 200" className="donut" role="img" aria-label="Share of damage by ability">
        {arcs.map(({ s, d }) => (
          <path
            key={s.key}
            d={d}
            className={`slice ${s.slot}${active && active !== s.key ? ' dim' : ''}`}
            tabIndex={0}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(s.key)}
            onBlur={() => setActive(null)}
          >
            <title>{`${s.name}: ${pct(s.share * 100, 1)} (${compact(s.total)})`}</title>
          </path>
        ))}
        <text x="100" y={shown ? 92 : 98} textAnchor="middle" className="donut-big">{shown ? pct(shown.share * 100, 1) : compact(total)}</text>
        <text x="100" y={shown ? 110 : 116} textAnchor="middle" className="donut-small">{shown ? truncate(shown.name, 20) : 'total damage'}</text>
        {shown && <text x="100" y="126" textAnchor="middle" className="donut-small">{compact(shown.total)}{shown.casts ? ` · ${shown.casts} casts` : ''}</text>}
      </svg>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li
            key={s.key}
            className={active === s.key ? 'on' : ''}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive(null)}
          >
            <span className={`swatch ${s.slot}`} aria-hidden="true" />
            {s.icon ? <GameIcon file={s.icon} size={16} /> : <BlankIcon size={16} />}
            <span className="lg-name">{s.name}</span>
            <span className="lg-pct">{pct(s.share * 100, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function arcPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  return `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- Gear ----------

function GearTable({ gear }: { gear: GearItem[] }) {
  const levels = gear.map((g) => g.itemLevel).filter((v): v is number => v !== null && v > 0);
  const avg = levels.length ? levels.reduce((t, v) => t + v, 0) / levels.length : null;
  const missing = gear.filter((g) => g.enchantable && !g.enchant && !g.enchantId);
  return (
    <>
      <p className="muted small">
        {avg !== null && <>Average item level <strong className="ink">{avg.toFixed(1)}</strong>. </>}
        {missing.length > 0
          ? <>No enchant on: {missing.map((g) => g.slotName.toLowerCase()).join(', ')}.</>
          : 'Every enchantable slot is enchanted.'}
      </p>
      <div className="scroll">
        <table className="grid gear">
          <thead><tr><th>Slot</th><th>Item</th><th className="r">iLvl</th><th>Enchant</th></tr></thead>
          <tbody>
            {gear.map((g) => (
              <tr key={`${g.slot}-${g.id}`}>
                <td className="muted">{g.slotName}</td>
                <td>
                  <span className="with-icon">
                    <GameIcon file={g.icon} size={22} />
                    <span className={QUALITY[g.quality ?? 1] ?? 'q-common'}>{g.name ?? `Item ${g.id}`}</span>
                    {g.gems.map((gem, i) => (
                      <span key={i} title={`Gem ${gem.id}${gem.itemLevel ? `, item level ${gem.itemLevel}` : ''}`}>
                        <GameIcon file={gem.icon} size={14} alt="Gem" />
                      </span>
                    ))}
                  </span>
                </td>
                <td className="r">{g.itemLevel ?? '–'}</td>
                <td className={g.enchant || g.enchantId ? 'small' : 'small muted'}>
                  {g.enchant ?? (g.enchantId ? `Enchant ${g.enchantId}` : g.enchantable ? <span className="no-enchant">None</span> : '–')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
