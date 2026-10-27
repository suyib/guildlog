// One analysis, split into sections picked from the sidebar.
import { useEffect, useState } from 'react';
import { isGeneralBuff } from '../../server/buffs';
import type { AnalysisResult, Healing, PlayerSnapshot } from '../../server/types';
import { loadPortrait } from '../api';
import { compact, mmss, n0, pct } from '../format';
import { type GlyphName, useNav } from '../nav';
import { healingFeedback, isHealerSnapshot } from '../../server/analysis';
import { DamageDonut, DpsChart, GearTable, StatsList } from './charts';
import Feedback, { FeedbackPanels } from './Feedback';
import BossRankLine from './BossRankLine';
import Glyph from './Glyph';
import { ClassIcon, GameIcon, classCss, compareLabel, parseCss } from './icons';
import Timeline from './Timeline';
import { DeathList, DotsPanel, GuildPanel, MitigationFacts, PotionsAndDebuffs } from './Insights';
import { tankCanBeCritCapped } from '../../server/gameData';

const OTHER_CLASS = 'other class';
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const gapTotal = (s: PlayerSnapshot) => Math.round(s.gaps.reduce((t, g) => t + g.seconds, 0));
const lust = (s: PlayerSnapshot) => s.buffs.find((b) => b.name === 'Bloodlust' || b.name === 'Heroism')?.uptimePct ?? null;

interface Row { label: string; s: PlayerSnapshot; me?: boolean; sameClass: boolean }

export default function ResultView({ result }: { result: AnalysisResult }) {
  const { section, view } = useNav();
  const healing = view === 'healing' ? result.dashboard?.healing ?? result.player.healing : undefined;
  const me = result.player;
  const all: Row[] = [
    { label: 'You', s: me, me: true, sameClass: true },
    ...result.comparisons.map((c) => ({ label: c.label, s: c.snapshot, sameClass: c.sameClass ?? c.snapshot.className === me.className })),
  ];
  const crossClass = all.filter((p) => !p.sameClass);

  return (
    <div className="result">
      <FightHeader result={result} />
      {me.partial && (
        <p className="warning">
          <strong>This fight hasn&rsquo;t been read in full yet</strong>, so potions, damage over time, tank swings, death recaps and the cast timeline are missing ({me.partial.replace(/\.$/, '')}). Click Analyze again in a couple of minutes, or an officer can use Read now on the raid&rsquo;s Past raids card.
        </p>
      )}
      {crossClass.length > 0 && (section === 'overview' || section === 'compare') && (
        <p className="warning">
          <strong>Different {crossClass.every((p) => p.s.className === me.className) ? 'spec' : 'class or spec'}:</strong>{' '}
          {crossClass.map((p) => `${p.s.name} (${spaced(p.s.specName)} ${p.s.className})`).join(', ')} {crossClass.length > 1 ? 'aren\u2019t' : 'isn\u2019t'} a{' '}
          {spaced(me.specName)} {me.className}, so only general stats are compared (DPS, parse, active time, item level, downtime, deaths, damage taken and
          shared buffs). Rotation and cooldown comparisons are skipped.
        </p>
      )}
      {section === 'overview' && (healing ? <HealingOverview result={result} h={healing} /> : <Overview result={result} />)}
      {section === 'rotation' && <Rotation result={result} all={all} />}
      {section === 'damage' && (healing ? <HealingView result={result} h={healing} /> : <DamageView result={result} />)}
      {section === 'gear' && <GearView result={result} />}
      {section === 'buffs' && <BuffsView result={result} />}
      {section === 'compare' && (healing && all.slice(1).some((p) => isHealerSnapshot(p.s)) ? <HealingCompareView all={all} /> : <CompareView all={all} />)}
    </div>
  );
}

// ---------- Header ----------

function FightHeader({ result }: { result: AnalysisResult }) {
  const me = result.player;
  const reportLink = `https://${me.host}/reports/${me.reportCode}?fight=${me.fightId}`;
  return (
    <header className="fight-head">
      <div className="fight-id">
        <Portrait snapshot={me} />
        <div>
          <div className="eyebrow">
            {me.encounterName} · <span className={me.kill ? 'kill' : 'wipe'}>{me.kill ? 'Kill' : 'Wipe'}</span> · {mmss(me.fightSeconds)}
          </div>
          <h1>
            <span className={classCss(me.className)}>{me.name}</span> <span className="spec">{spaced(me.specName)} {me.className}</span>
          </h1>
          <BossRankLine host={me.host} encounterId={me.encounterId} name={me.encounterName} />
        </div>
      </div>
      <div className="fight-actions">
        <ViewToggle result={result} />
        <span className="pill"><Glyph name="users" size={16} />{compareLabel(result.compareKey)}</span>
        <a className="button ghost" href={reportLink} target="_blank" rel="noreferrer"><Glyph name="link" size={16} />Warcraft Logs</a>
        {result.id && <ShareButton path={`/a/${result.id}`} />}
      </div>
    </header>
  );
}

/** Damage done / Healing done, shown when the player did any healing. */
function ViewToggle({ result }: { result: AnalysisResult }) {
  const { view, setView } = useNav();
  if (!result.dashboard?.healing && !result.player.healing) return null;
  return (
    <div className="seg" role="group" aria-label="Show damage or healing">
      <button type="button" className={view === 'damage' ? 'on' : ''} aria-pressed={view === 'damage'} onClick={() => setView('damage')}><Glyph name="bolt" size={16} />Damage done</button>
      <button type="button" className={view === 'healing' ? 'on' : ''} aria-pressed={view === 'healing'} onClick={() => setView('healing')}><Glyph name="pulse" size={16} />Healing done</button>
    </div>
  );
}

/** Copies a link to this site (path: /a/<id>, /#/raids?raid=…). */
export function ShareButton({ path, label = 'Copy share link' }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;
  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          window.prompt('Copy this link:', url);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Glyph name={copied ? 'check' : 'copy'} size={16} />
      {copied ? 'Link copied' : label}
    </button>
  );
}

/** The character's in-game portrait when available, otherwise their class icon. */
function Portrait({ snapshot }: { snapshot: PlayerSnapshot }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    loadPortrait(snapshot).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [snapshot.host, snapshot.reportCode, snapshot.name, snapshot.server]);
  if (!url) return <ClassIcon className={snapshot.className} size={44} />;
  return <img className={`portrait ${classCss(snapshot.className)}-border`} src={url} width={44} height={44} alt={`${snapshot.name}'s character portrait`} />;
}

// ---------- Overview ----------

interface Delta { text: string; good: boolean }

function Kpi({ glyph, label, value, valueCls = '', delta, sub }: { glyph: GlyphName; label: string; value: string; valueCls?: string; delta?: Delta | null; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-icon"><Glyph name={glyph} size={18} /></span>
        {label}
      </div>
      <div className={`kpi-value ${valueCls}`}>{value}</div>
      {delta ? (
        <div className={`kpi-sub ${delta.good ? 'up' : 'down'}`}>
          <Glyph name={delta.good ? 'up' : 'down'} size={14} />
          {delta.text}
        </div>
      ) : (
        <div className="kpi-sub">{sub ?? ' '}</div>
      )}
    </div>
  );
}

function Overview({ result }: { result: AnalysisResult }) {
  const me = result.player;
  const ref = result.comparisons[0]?.snapshot;
  const d = result.dashboard;
  const gear = d?.gear.map((g) => g.itemLevel).filter((v): v is number => !!v) ?? [];
  const avgIlvl = gear.length ? gear.reduce((t, v) => t + v, 0) / gear.length : null;
  const vs = ref ? ` vs ${ref.name}` : '';

  const dpsDelta: Delta | null = ref && ref.dps > 0 ? { text: `${Math.abs(((me.dps - ref.dps) / ref.dps) * 100).toFixed(1)}%${vs}`, good: me.dps >= ref.dps } : null;
  const parseDelta: Delta | null = ref && ref.parsePercent !== null && me.parsePercent !== null
    ? { text: `${Math.abs(Math.round(me.parsePercent - ref.parsePercent))} pts${vs}`, good: me.parsePercent >= ref.parsePercent } : null;
  const activeDelta: Delta | null = ref && ref.activePct !== null && me.activePct !== null
    ? { text: `${Math.abs(me.activePct - ref.activePct).toFixed(1)} pts${vs}`, good: me.activePct >= ref.activePct } : null;
  const ilvlDelta: Delta | null = ref && ref.itemLevel && me.itemLevel && ref.itemLevel !== me.itemLevel
    ? { text: `${Math.abs(me.itemLevel - ref.itemLevel)}${vs}`, good: me.itemLevel > ref.itemLevel } : null;

  const facts: [string, string][] = [
    ['Damage done', compact(me.total)],
    ['Fight length', mmss(me.fightSeconds)],
    ['Casts', n0(me.castSeconds.length)],
    ['Time with no casts', `${gapTotal(me)}s`],
    ['Bloodlust uptime', pct(lust(me))],
    ['Deaths', String(me.deaths.length)],
    ['Damage taken', compact(me.damageTaken.reduce((t, x) => t + x.total, 0))],
    ...(me.mitigation ? [['Boss swings avoided', `${pct(me.mitigation.avoidPct, 1)} of ${n0(me.mitigation.swings)}`] as [string, string]] : []),
    ...(me.mitigation && tankCanBeCritCapped(me.host) ? [['Crits taken', String(me.mitigation.crits)] as [string, string]] : []),
  ];

  return (
    <>
      <div className="kpis">
        <Kpi glyph="bolt" label="DPS" value={n0(me.dps)} delta={dpsDelta} sub={`${compact(me.total)} damage`} />
        <Kpi glyph="target" label="Parse" value={me.parsePercent === null ? '–' : String(Math.round(me.parsePercent))} valueCls={parseCss(me.parsePercent)} delta={parseDelta} sub={me.parsePercent === null ? 'Not ranked' : 'Percentile for your spec'} />
        <Kpi glyph="timer" label="Active time" value={pct(me.activePct, 1)} delta={activeDelta} sub={`${gapTotal(me)}s with no casts`} />
        <Kpi glyph="shield" label="Item level" value={me.itemLevel ? String(me.itemLevel) : avgIlvl ? avgIlvl.toFixed(0) : '–'} delta={ilvlDelta} sub={avgIlvl ? `Gear average ${avgIlvl.toFixed(1)}` : undefined} />
      </div>

      <div className="grid-2-1">
        <section className="panel">
          <h2 className="panel-title">{d && d.dpsSeries.length > 1 ? 'DPS over the fight' : 'Cast timeline'}</h2>
          {d && d.dpsSeries.length > 1 ? (
            <DpsChart series={d.dpsSeries} average={me.dps} snapshot={me} />
          ) : (
            <Timeline players={[{ label: 'You', snapshot: me }]} />
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title">Damage by ability</h2>
          <DamageDonut abilities={me.abilities} total={me.total} />
        </section>
      </div>

      <Feedback result={result} />

      <GuildPanel result={result} value={me.dps} />

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">Cooldowns</h2>
          <CooldownList snapshot={me} />
        </section>
        <section className="panel">
          <h2 className="panel-title">Fight facts</h2>
          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}

function CooldownList({ snapshot }: { snapshot: PlayerSnapshot }) {
  if (snapshot.cooldowns.length === 0) return <p className="muted small">No tracked cooldowns for this class yet.</p>;
  return (
    <ul className="cd-list">
      {snapshot.cooldowns.map((c) => (
        <li key={c.name} className={c.uses < c.possible ? 'short' : ''}>
          <GameIcon file={c.icon} size={22} />
          <span className="cd-name">{c.name}<span className="muted small">{c.times.length ? c.times.map(mmss).join(', ') : 'not used'}</span></span>
          <span className="cd-count">{c.uses} / {c.possible}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Healing done ----------

function HealingOverview({ result, h }: { result: AnalysisResult; h: Healing }) {
  const me = result.player;
  const d = result.dashboard;
  const gear = d?.gear.map((g) => g.itemLevel).filter((v): v is number => !!v) ?? [];
  const avgIlvl = gear.length ? gear.reduce((t, v) => t + v, 0) / gear.length : null;
  // Compared on healing when the other player is a healer too
  const ref = result.comparisons.map((c) => c.snapshot).find(isHealerSnapshot);
  const rh = ref?.healing;
  const vs = ref ? ` vs ${ref.name}` : '';
  const feedback = healingFeedback(me, h, ref);
  const hpsDelta: Delta | null = rh && rh.hps > 0 ? { text: `${Math.abs(((h.hps - rh.hps) / rh.hps) * 100).toFixed(1)}%${vs}`, good: h.hps >= rh.hps } : null;
  const parseDelta: Delta | null = rh && rh.parse !== null && h.parse !== null ? { text: `${Math.abs(Math.round(h.parse - rh.parse))} pts${vs}`, good: h.parse >= rh.parse } : null;
  const activeDelta: Delta | null = rh && rh.activePct !== null && h.activePct !== null ? { text: `${Math.abs(h.activePct - rh.activePct).toFixed(1)} pts${vs}`, good: h.activePct >= rh.activePct } : null;
  const facts: [string, string][] = [
    ['Healing done', compact(h.total)],
    ['Overhealing', `${compact(h.overheal)} (${pct(h.overhealPct)})`],
    ['Among the healers', h.rank ? `#${h.rank.place} of ${h.rank.of}` : '–'],
    ['Fight length', mmss(me.fightSeconds)],
    ['Casts', n0(me.castSeconds.length)],
    ['Damage done', compact(me.total)],
    ['Deaths', String(me.deaths.length)],
  ];
  return (
    <>
      {result.comparisons.length > 0 && !ref && <p className="muted small">The player you compared with isn&rsquo;t a healer on this fight, so the comparison is on Damage done.</p>}
      <div className="kpis">
        <Kpi glyph="pulse" label="HPS" value={n0(h.hps)} delta={hpsDelta} sub={`${compact(h.total)} healing`} />
        <Kpi glyph="target" label="Healing parse" value={h.parse === null ? '–' : String(Math.round(h.parse))} valueCls={parseCss(h.parse)} delta={parseDelta} sub={h.parse === null ? 'Not ranked' : 'Percentile for your spec'} />
        <Kpi glyph="timer" label="Active time" value={pct(h.activePct, 1)} delta={activeDelta} sub={`${pct(h.overhealPct)} overhealing`} />
        <Kpi glyph="shield" label="Item level" value={me.itemLevel ? String(me.itemLevel) : avgIlvl ? avgIlvl.toFixed(0) : '–'} sub={avgIlvl ? `Gear average ${avgIlvl.toFixed(1)}` : undefined} />
      </div>

      <div className="grid-2-1">
        <section className="panel">
          <h2 className="panel-title">{h.hpsSeries.length > 1 ? 'Healing over the fight' : 'Cast timeline'}</h2>
          {h.hpsSeries.length > 1 ? <DpsChart series={h.hpsSeries} average={h.hps} snapshot={me} kind="hps" /> : <Timeline players={[{ label: 'You', snapshot: me }]} />}
        </section>
        <section className="panel">
          <h2 className="panel-title">Healing by ability</h2>
          <DamageDonut abilities={h.abilities} total={h.total} noun="healing" />
        </section>
      </div>

      <FeedbackPanels work={feedback.work} good={feedback.good} />

      <GuildPanel result={result} value={h.hps} />

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">Cooldowns</h2>
          <CooldownList snapshot={me} />
        </section>
        <section className="panel">
          <h2 className="panel-title">Fight facts</h2>
          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}

function HealingView({ result, h }: { result: AnalysisResult; h: Healing }) {
  const me = result.player;
  const topShare = Math.max(...h.abilities.map((a) => a.share), 0.0001);
  return (
    <>
      <section className="panel donut-wide">
        <h2 className="panel-title">Share of healing</h2>
        <DamageDonut abilities={h.abilities} total={h.total} noun="healing" />
      </section>
      <section className="panel">
        <h2 className="panel-title">Healing done by ability</h2>
        <p className="muted small">Amounts are healing that landed. Overheal is the part that went to people already at full health.</p>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr><th>Name</th><th className="amount-col">Amount</th><th className="r">Casts</th><th className="r">Avg heal</th><th className="r">Crit %</th><th className="r">Overheal</th></tr>
            </thead>
            <tbody>
              {h.abilities.map((a) => (
                <tr key={`${a.name}-${a.id}-${a.isPet ? 'pet' : 'own'}`} className={(a.overhealPct ?? 0) >= 60 && a.share >= 0.1 ? 'warn' : ''}>
                  <td>
                    <span className="with-icon">
                      <GameIcon file={a.icon} />
                      {a.name}
                      {a.isPet && <span className="muted small">(pet{a.petName ? `: ${a.petName}` : ''})</span>}
                    </span>
                  </td>
                  <td className="amount-col">
                    <div className="amount">
                      <span className="pct">{pct(a.share * 100, 2)}</span>
                      <progress className={`bar ${classCss(me.className)}-bar`} max={1} value={a.share / topShare} aria-label={`${a.name} share`} />
                      <span className="total">{compact(a.total)}</span>
                    </div>
                  </td>
                  <td className="r">{a.casts || '–'}</td>
                  <td className="r">{n0(a.avgHeal)}</td>
                  <td className="r">{pct(a.critPct, 1)}</td>
                  <td className="r">{pct(a.overhealPct, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---------- Rotation & cooldowns ----------

function Rotation({ result, all }: { result: AnalysisResult; all: Row[] }) {
  const me = result.player;
  const same = all.filter((p) => p.sameClass);
  const icons = iconMap(all);
  // Everything cast (healing spells and totems too, not only damage), most cast first; auto attacks left out
  const castTotals = new Map<string, number>();
  for (const p of same) for (const [name, n] of Object.entries(p.s.castCounts)) if (!/^(Auto Shot|Shoot|Melee|Auto Attack|Attack)$/.test(name)) castTotals.set(name, (castTotals.get(name) ?? 0) + n);
  const castNames = [...castTotals].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name]) => name);
  const cdNames = Array.from(new Set(same.flatMap((p) => p.s.cooldowns.map((c) => c.name))));

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Cast timeline</h2>
        <p className="muted small">Each bar is a cast, colored by ability; short red bars are auto attacks. Red bands are gaps over 4 seconds without a cast, and yellow dots are major cooldowns. Hover a row to see what was cast and when Bloodlust (orange band) and your cooldowns (yellow bars) were up.</p>
        <Timeline players={all.map((p) => ({ label: p.me ? 'You' : p.s.name, snapshot: p.s }))} />
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">Cooldowns</h2>
          {same.length > 1 ? (
            <PlayerTable players={same}>
              {cdNames.map((name) => (
                <TRow key={name} label={name} icon={icons.get(name)} cells={same.map((p) => {
                  const c = p.s.cooldowns.find((x) => x.name === name);
                  return c ? `${c.uses} / ${c.possible}` : '0';
                })} />
              ))}
            </PlayerTable>
          ) : (
            <CooldownList snapshot={me} />
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title">Casts per minute</h2>
          <PlayerTable players={same}>
            {castNames.map((name) => (
              <TRow key={name} label={name} icon={icons.get(name)} cells={same.map((p) => (p.s.castsPerMinute[name] ? p.s.castsPerMinute[name].toFixed(1) : '–'))} />
            ))}
          </PlayerTable>
        </section>
      </div>
    </>
  );
}

// ---------- Damage ----------

function DamageView({ result }: { result: AnalysisResult }) {
  const me = result.player;
  const topShare = Math.max(...me.abilities.map((a) => a.share), 0.0001);
  return (
    <>
    <section className="panel donut-wide">
      <h2 className="panel-title">Share of damage</h2>
      <DamageDonut abilities={me.abilities} total={me.total} />
    </section>
    <section className="panel">
      <h2 className="panel-title">Damage done by ability</h2>
      <div className="scroll">
        <table className="grid">
          <thead>
            <tr><th>Name</th><th className="amount-col">Amount</th><th className="r">Casts</th><th className="r">Avg hit</th><th className="r">Crit %</th><th className="r">Miss %</th></tr>
          </thead>
          <tbody>
            {me.abilities.map((a) => (
              <tr key={`${a.name}-${a.id}-${a.isPet ? 'pet' : 'own'}`}>
                <td>
                  <span className="with-icon">
                    <GameIcon file={a.isPet ? 'ability_hunter_pet_cat' : a.icon} />
                    {a.name}
                    {a.isPet && <span className="muted small">(pet{a.petName ? `: ${a.petName}` : ''})</span>}
                  </span>
                </td>
                <td className="amount-col">
                  <div className="amount">
                    <span className="pct">{pct(a.share * 100, 2)}</span>
                    <progress className={`bar ${classCss(me.className)}-bar`} max={1} value={a.share / topShare} aria-label={`${a.name} share`} />
                    <span className="total">{compact(a.total)}</span>
                  </div>
                </td>
                <td className="r">{a.casts || '–'}</td>
                <td className="r">{n0(a.avgHit)}</td>
                <td className="r">{pct(a.critPct, 1)}</td>
                <td className="r">{pct(a.missPct, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
    </>
  );
}

// ---------- Gear & stats ----------

function GearView({ result }: { result: AnalysisResult }) {
  const d = result.dashboard;
  if (!d) {
    return (
      <section className="panel">
        <h2 className="panel-title">Gear & stats</h2>
        <p className="muted">This analysis was saved before gear and stats were added. Click Analyze again to load them.</p>
      </section>
    );
  }
  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Stats at the pull</h2>
        {d.stats.length > 0 ? (
          <>
            <p className="muted small">Hover or tap a stat to see what it does for a {result.player.className}.</p>
            <StatsList stats={d.stats} className={result.player.className} host={result.player.host} />
          </>
        ) : (
          <p className="muted small">No stats in this log. Warcraft Logs only records them when the logger saw you at the pull.</p>
        )}
      </section>
      <section className="panel">
        <h2 className="panel-title">Gear</h2>
        {d.gear.length > 0 ? <GearTable gear={d.gear} /> : <p className="muted small">No gear data in this log.</p>}
      </section>
    </>
  );
}

// ---------- Buffs & survival ----------

function BuffsView({ result }: { result: AnalysisResult }) {
  const me = result.player;
  const ref = result.comparisons[0]?.snapshot;
  const refSameClass = result.comparisons[0]?.sameClass ?? true;
  const myBuffs = new Map(me.buffs.map((b) => [b.name, b.uptimePct]));
  const refBuffs = new Map((ref?.buffs ?? []).map((b) => [b.name, b.uptimePct]));
  const icons = new Map<string, string>();
  for (const b of [...me.buffs, ...(ref?.buffs ?? [])]) if (b.icon) icons.set(b.name, b.icon);
  // Across classes, hide their class-only buffs (stances, forms, auras) unless you had them too.
  const names = Array.from(new Set([...me.buffs, ...(ref?.buffs ?? [])].filter((b) => b.uptimePct >= (ref ? 20 : 5)).map((b) => b.name)))
    .filter((name) => refSameClass || isGeneralBuff(name) || (myBuffs.get(name) ?? 0) > 0)
    .sort((a, b) => ref
      ? ((refBuffs.get(b) ?? 0) - (myBuffs.get(b) ?? 0)) - ((refBuffs.get(a) ?? 0) - (myBuffs.get(a) ?? 0))
      : (myBuffs.get(b) ?? 0) - (myBuffs.get(a) ?? 0))
    .slice(0, 20);

  return (
    <>
      <Survival result={result} />
      {(me.potions || me.raidDebuffs || me.dots?.length) && (
        <div className="grid-2">
          <PotionsAndDebuffs me={me} />
          <DotsPanel me={me} />
        </div>
      )}
      <section className="panel">
        <h2 className="panel-title">{ref ? `Buff uptime vs ${ref.name}` : 'Buff uptime'}</h2>
        {ref && !refSameClass && <p className="muted small">Different class: their class-only buffs (stances, forms, auras) are hidden.</p>}
        {names.length === 0 ? (
          <p className="muted small">No buffs recorded.</p>
        ) : (
          <div className="scroll">
            <table className="grid">
              <thead><tr><th>Buff</th><th className="r">You</th>{ref && <th className="r">{ref.name}</th>}</tr></thead>
              <tbody>
                {names.map((name) => {
                  const mine = myBuffs.get(name) ?? 0;
                  const theirs = refBuffs.get(name) ?? 0;
                  return (
                    <tr key={name} className={ref && theirs - mine >= 25 ? 'warn' : ''}>
                      <td><span className="with-icon"><GameIcon file={icons.get(name)} />{name}</span></td>
                      <td className="r"><Uptime v={mine} /></td>
                      {ref && <td className="r"><Uptime v={theirs} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Damage summary, avoidable damage and deaths for the Buffs & survival section. */
function Survival({ result }: { result: AnalysisResult }) {
  const me = result.player;
  const sv = result.dashboard?.survival;
  const takenTotal = sv?.total ?? me.damageTaken.reduce((t, x) => t + x.total, 0);
  const perSecond = me.fightSeconds > 0 ? takenTotal / me.fightSeconds : 0;
  const avoidable = sv?.abilities.filter((a) => a.avoidable) ?? [];
  const who = sv?.isTank ? 'the other tanks' : 'the non-tanks';

  return (
    <>
      <div className="kpis">
        <Kpi glyph="shield" label="Damage taken" value={compact(takenTotal)} sub={`${compact(perSecond)} per second`} />
        <Kpi
          glyph="alert"
          label="Likely avoidable"
          value={sv ? compact(sv.avoidableTotal) : '–'}
          valueCls={sv && sv.avoidableTotal > 0 ? 'warn-text' : ''}
          sub={sv ? (takenTotal > 0 ? `${Math.round((sv.avoidableTotal / takenTotal) * 100)}% of your damage taken` : 'none') : 'Not available for this log'}
        />
        <Kpi
          glyph="users"
          label="Raid median"
          value={sv ? compact(sv.raidMedianTotal) : '–'}
          delta={sv && sv.raidMedianTotal > 0 ? { text: `${Math.abs(Math.round(((takenTotal - sv.raidMedianTotal) / sv.raidMedianTotal) * 100))}% ${takenTotal <= sv.raidMedianTotal ? 'less' : 'more'} than ${who}`, good: takenTotal <= sv.raidMedianTotal } : null}
          sub={sv ? `Across ${who}` : 'Not available for this log'}
        />
        <Kpi glyph="pulse" label="Deaths" value={String(me.deaths.length)} sub={me.deaths.length ? me.deaths.map((d) => mmss(d.seconds)).join(', ') : 'Alive the whole fight'} />
      </div>

      <section className="panel">
        <h2 className="panel-title">Damage taken over the fight</h2>
        {result.dashboard?.takenSeries && result.dashboard.takenSeries.length > 1 ? (
          <>
            <p className="muted small">Hover the line to see what hit you hardest at each moment. Spikes are usually boss abilities; marks show when you died.</p>
            <DpsChart
              series={result.dashboard.takenSeries}
              average={perSecond}
              kind="taken"
              wide
              marks={me.deaths.map((d) => ({ t: d.seconds, name: `Died (${d.by})` }))}
              markLabel="death"
            />
          </>
        ) : (
          <p className="muted small">{result.dashboard ? 'Warcraft Logs didn\u2019t return your damage taken over time for this fight.' : 'Click Analyze again to load damage taken over time.'}</p>
        )}
      </section>

      <div className="grid-2-1">
        <section className="panel">
          <h2 className="panel-title">Damage taken by ability</h2>
          {sv ? (
            <>
              <p className="muted small">
                &ldquo;Likely avoidable&rdquo; means it hit fewer than half of {who === 'the other tanks' ? 'the non-tanks' : who}: raid-wide damage hits everyone, while things you can move out of only hit the people who stood in them. Check the boss&rsquo;s mechanics before treating it as a mistake.
              </p>
              <div className="scroll">
                <table className="grid">
                  <thead><tr><th>Ability</th><th className="r">You</th><th className="r">Raid median</th><th className="r">Players hit</th><th></th></tr></thead>
                  <tbody>
                    {sv.abilities.slice(0, 15).map((a) => (
                      <tr key={a.name} className={a.avoidable && a.total > a.raidMedian ? 'warn' : ''}>
                        <td><span className="with-icon"><GameIcon file={a.icon} />{a.name}</span></td>
                        <td className="r">{compact(a.total)}</td>
                        <td className="r muted">{compact(a.raidMedian)}</td>
                        <td className="r muted">{a.playersHit} / {a.raidSize}</td>
                        <td>{a.avoidable && <span className="badge badge-warn">Likely avoidable</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : me.damageTaken.length > 0 ? (
            <>
              <p className="muted small">Raid comparison isn&rsquo;t available for this analysis. Click Analyze again to load it.</p>
              <table className="grid">
                <thead><tr><th>Ability</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {me.damageTaken.slice(0, 12).map((x) => (
                    <tr key={x.name}><td>{x.name}</td><td className="r">{compact(x.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted small">No damage taken.</p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Survival</h2>
          {me.deaths.length === 0 ? (
            <p className="good-note"><Glyph name="check" size={16} />No deaths</p>
          ) : (
            <DeathList deaths={me.deaths} />
          )}
          {me.mitigation && <MitigationFacts m={me.mitigation} critCap={tankCanBeCritCapped(me.host)} />}
          {sv && (
            <dl className="facts single">
              <div><dt>Rank for damage taken</dt><dd>{sv.rank} of {sv.compared}</dd></div>
              <div><dt>Avoidable abilities that hit you</dt><dd>{avoidable.length}</dd></div>
              {avoidable[0] && <div><dt>Biggest avoidable hit</dt><dd>{avoidable[0].name}</dd></div>}
            </dl>
          )}
          <p className="muted small">Rank 1 is the least damage taken{sv?.isTank ? ' among tanks' : ' among non-tanks'}.</p>
        </section>
      </div>
    </>
  );
}

// ---------- Side by side ----------

function CompareView({ all }: { all: Row[] }) {
  const icons = iconMap(all);
  return (
    <section className="panel">
      <h2 className="panel-title">Side by side</h2>
      <PlayerTable players={all} showCrossClass>
        <tr className="group"><td colSpan={all.length + 1}>General</td></tr>
        <TRow label="DPS" cells={all.map((p) => n0(p.s.dps))} />
        <tr>
          <td>Parse</td>
          {all.map((p, i) => (
            <td key={i} className={`r strong ${parseCss(p.s.parsePercent)}`}>{p.s.parsePercent === null ? '–' : Math.round(p.s.parsePercent)}</td>
          ))}
        </tr>
        <TRow label="Fight length" cells={all.map((p) => mmss(p.s.fightSeconds))} />
        <TRow label="Active time" cells={all.map((p) => pct(p.s.activePct))} />
        <TRow label="Item level" cells={all.map((p) => (p.s.itemLevel ? String(p.s.itemLevel) : '–'))} />
        <TRow label="Time with no casts" cells={all.map((p) => `${gapTotal(p.s)}s`)} />
        <TRow label="Bloodlust/Heroism uptime" icon={icons.get('Bloodlust') ?? 'spell_nature_bloodlust'} cells={all.map((p) => pct(lust(p.s)))} />
        <TRow label="Deaths" cells={all.map((p) => String(p.s.deaths.length))} />
        <TRow label="Damage taken" cells={all.map((p) => compact(p.s.damageTaken.reduce((t, x) => t + x.total, 0)))} />
        <tr className="group"><td colSpan={all.length + 1}>Top abilities (share of damage)</td></tr>
        {Array.from(new Set(all.filter((p) => p.sameClass).flatMap((p) => p.s.abilities.slice(0, 5).map((a) => a.name)))).slice(0, 8).map((name) => (
          <TRow key={name} label={name} icon={icons.get(name)} cells={all.map((p) => {
            if (!p.sameClass) return OTHER_CLASS;
            const a = p.s.abilities.find((x) => x.name === name);
            return a ? pct(a.share * 100, 1) : '–';
          })} />
        ))}
      </PlayerTable>
    </section>
  );
}

/** Side by side for healers: healing numbers instead of damage. */
function HealingCompareView({ all }: { all: Row[] }) {
  const icons = iconMap(all);
  for (const p of all) for (const a of p.s.healing?.abilities ?? []) if (a.icon) icons.set(a.name, a.icon);
  const healers = all.filter((p) => p.s.healing);
  const H = (p: Row) => p.s.healing;
  const spells = Array.from(new Set(healers.flatMap((p) => H(p)!.abilities.slice(0, 5).map((a) => a.name)))).slice(0, 10);
  return (
    <section className="panel">
      <h2 className="panel-title">Side by side (healing)</h2>
      <PlayerTable players={all} showCrossClass>
        <tr className="group"><td colSpan={all.length + 1}>General</td></tr>
        <TRow label="HPS" cells={all.map((p) => (H(p) ? n0(H(p)!.hps) : '–'))} />
        <tr>
          <td>Healing parse</td>
          {all.map((p, i) => (
            <td key={i} className={`r strong ${parseCss(H(p)?.parse ?? null)}`}>{H(p)?.parse == null ? '–' : Math.round(H(p)!.parse!)}</td>
          ))}
        </tr>
        <TRow label="Healing done" cells={all.map((p) => (H(p) ? compact(H(p)!.total) : '–'))} />
        <TRow label="Overhealing" cells={all.map((p) => (H(p) ? pct(H(p)!.overhealPct) : '–'))} />
        <TRow label="Active time" cells={all.map((p) => pct(H(p)?.activePct ?? p.s.activePct))} />
        <TRow label="Among the healers" cells={all.map((p) => (H(p)?.rank ? `#${H(p)!.rank!.place} of ${H(p)!.rank!.of}` : '–'))} />
        <TRow label="Item level" cells={all.map((p) => (p.s.itemLevel ? String(p.s.itemLevel) : '–'))} />
        <TRow label="Time with no casts" cells={all.map((p) => `${gapTotal(p.s)}s`)} />
        <TRow label="Deaths" cells={all.map((p) => String(p.s.deaths.length))} />
        <tr className="group"><td colSpan={all.length + 1}>Top spells (share of healing, overheal)</td></tr>
        {spells.map((name) => (
          <TRow key={name} label={name} icon={icons.get(name)} cells={all.map((p) => {
            const a = H(p)?.abilities.find((x) => x.name === name);
            return a ? `${pct(a.share * 100, 1)} · ${pct(a.overhealPct)}` : '–';
          })} />
        ))}
      </PlayerTable>
    </section>
  );
}

// ---------- Shared bits ----------

function iconMap(all: Row[]) {
  const icons = new Map<string, string>();
  for (const p of all) {
    for (const a of p.s.abilities) if (a.icon) icons.set(a.name, a.icon);
    for (const c of p.s.cooldowns) if (c.icon) icons.set(c.name, c.icon);
    for (const b of p.s.buffs) if (b.icon) icons.set(b.name, b.icon);
  }
  return icons;
}

function PlayerTable({ players, children, showCrossClass = false }: { players: Row[]; children: React.ReactNode; showCrossClass?: boolean }) {
  return (
    <div className="scroll">
      <table className="grid">
        <thead>
          <tr>
            <th></th>
            {players.map((p) => (
              <th key={p.label} className="r">
                <span className="th-player">
                  <ClassIcon className={p.s.className} size={16} />
                  <span className={classCss(p.s.className)}>{p.me ? 'You' : p.s.name}</span>
                </span>
                {showCrossClass && !p.sameClass && <div className="tag">{p.s.className === players[0].s.className ? 'Different spec' : 'Different class'}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TRow({ label, cells, icon }: { label: string; cells: string[]; icon?: string }) {
  return (
    <tr>
      <td>{icon ? <span className="with-icon"><GameIcon file={icon} />{label}</span> : label}</td>
      {cells.map((c, i) => <td key={i} className={c === OTHER_CLASS ? 'r muted small' : 'r'}>{c}</td>)}
    </tr>
  );
}

function Uptime({ v }: { v: number }) {
  return (
    <span className="uptime">
      <progress className="bar uptime-bar" max={100} value={Math.min(100, v)} aria-hidden="true" />
      {pct(v)}
    </span>
  );
}
