import type { AnalysisResult, PlayerSnapshot } from '../../server/types';
import { compact, mmss, n0, pct } from '../format';
import { SEVERITY_EMOJI, classEmoji } from './emoji';
import Timeline from './Timeline';
import { isGeneralBuff } from '../../server/buffs';

const OTHER_CLASS = 'other class';

export default function ResultView({ result }: { result: AnalysisResult }) {
  const { player: me, comparisons, findings, notes } = result;
  const all: { label: string; s: PlayerSnapshot; me?: boolean; sameClass: boolean }[] = [
    { label: 'You', s: me, me: true, sameClass: true },
    ...comparisons.map((c) => ({ label: c.label, s: c.snapshot, sameClass: c.sameClass ?? c.snapshot.className === me.className })),
  ];
  const crossClass = all.filter((p) => !p.sameClass);

  // Class-specific rows only come from players of your class
  const sameClassPlayers = all.filter((p) => p.sameClass);
  const castNames = Array.from(
    new Set(sameClassPlayers.flatMap((p) => p.s.abilities.filter((a) => !a.isPet && a.casts > 0).slice(0, 6).map((a) => a.name))),
  ).slice(0, 8);
  const cdNames = Array.from(new Set(sameClassPlayers.flatMap((p) => p.s.cooldowns.map((c) => c.name))));
  const ref = comparisons[0]?.snapshot;
  const myBuffs = new Map(me.buffs.map((b) => [b.name, b.uptimePct]));
  const refBuffs = new Map((ref?.buffs ?? []).map((b) => [b.name, b.uptimePct]));
  const refSameClass = comparisons[0]?.sameClass ?? true;
  // Across classes, hide their class-only buffs (stances, forms, auras) unless you had them too.
  const buffNames = Array.from(new Set([...me.buffs, ...(ref?.buffs ?? [])].filter((b) => b.uptimePct >= 20).map((b) => b.name)))
    .filter((name) => refSameClass || isGeneralBuff(name) || (myBuffs.get(name) ?? 0) > 0);
  const reportLink = `https://${me.host}/reports/${me.reportCode}?fight=${me.fightId}`;
  const gapTotal = (s: PlayerSnapshot) => Math.round(s.gaps.reduce((t, g) => t + g.seconds, 0));
  const lust = (s: PlayerSnapshot) => s.buffs.find((b) => b.name === 'Bloodlust' || b.name === 'Heroism')?.uptimePct ?? null;

  return (
    <>
      <section className="card">
        <div className="head">
          <div>
            <h2>{classEmoji(me.className)} {me.name} <span className="muted">{me.specName.replace(/([a-z])([A-Z])/g, '$1 $2')} {me.className}</span></h2>
            <div className="muted small">
              🐉 {me.encounterName} · {me.kill ? '✅ Kill' : '💀 Wipe'} · ⏱️ {mmss(me.fightSeconds)} · <a href={reportLink} target="_blank" rel="noreferrer">open on Warcraft Logs ↗</a>
            </div>
          </div>
          <div className="stats">
            <Stat label="💥 DPS" value={n0(me.dps)} />
            <Stat label="📊 Parse" value={me.parsePercent === null ? '–' : String(Math.round(me.parsePercent))} />
            <Stat label="🏃 Active" value={pct(me.activePct)} />
            <Stat label="🛡️ Item level" value={me.itemLevel ? String(me.itemLevel) : '–'} />
          </div>
        </div>
      </section>

      {crossClass.length > 0 && (
        <section className="card warning-card">
          ⚠️ <strong>{crossClass.map((p) => p.s.name).join(', ')}</strong> {crossClass.length > 1 ? 'are' : 'is'} a different class.
          Only general things are compared: DPS, parse, active time, item level, downtime, deaths, damage taken and shared buffs like Bloodlust.
          Rotation and cooldown comparisons are skipped.
        </section>
      )}

      <section className="card">
        <h3>🎯 What to work on</h3>
        {findings.length === 0 && <p className="muted">🎉 Nothing stood out against the comparisons. Nice work!</p>}
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i}>
              <span className="sev" aria-label={`${f.severity} priority`}>{SEVERITY_EMOJI[f.severity]}</span>
              <div>
                <strong>{f.title}</strong>
                <p>{f.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        {findings.length > 0 && <p className="muted small">🔴 biggest gain · 🟠 worth fixing · ⚪ minor</p>}
        {notes.length > 0 && <p className="muted small">ℹ️ {notes.join(' · ')}</p>}
      </section>

      <section className="card">
        <h3>⚖️ Side by side</h3>
        {comparisons.length === 0 && <p className="muted small">No comparison could be loaded for this fight, so only your numbers are shown.</p>}
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                {all.map((p) => (
                  <th key={p.label} className="r">
                    {classEmoji(p.s.className)} {p.me ? 'You' : p.label}
                    {!p.sameClass && <div className="tag">⚠️ {p.s.className}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="group"><td colSpan={all.length + 1}>🌍 General</td></tr>
              <Row label="💥 DPS" cells={all.map((p) => n0(p.s.dps))} />
              <Row label="📊 Parse" cells={all.map((p) => (p.s.parsePercent === null ? '–' : String(Math.round(p.s.parsePercent))))} />
              <Row label="⏱️ Fight length" cells={all.map((p) => mmss(p.s.fightSeconds))} />
              <Row label="🏃 Active time" cells={all.map((p) => pct(p.s.activePct))} />
              <Row label="🛡️ Item level" cells={all.map((p) => (p.s.itemLevel ? String(p.s.itemLevel) : '–'))} />
              <Row label="😴 Time with no casts" cells={all.map((p) => `${gapTotal(p.s)}s`)} />
              <Row label="🥁 Bloodlust/Heroism uptime" cells={all.map((p) => pct(lust(p.s)))} />
              <Row label="💀 Deaths" cells={all.map((p) => String(p.s.deaths.length))} />
              {castNames.length > 0 && <tr className="group"><td colSpan={all.length + 1}>🔁 Casts per minute (same class only)</td></tr>}
              {castNames.map((name) => (
                <Row
                  key={name}
                  label={name}
                  cells={all.map((p) => (!p.sameClass ? OTHER_CLASS : p.s.castsPerMinute[name] ? p.s.castsPerMinute[name].toFixed(1) : '–'))}
                />
              ))}
              {cdNames.length > 0 && <tr className="group"><td colSpan={all.length + 1}>⚡ Cooldown uses: used / possible (same class only)</td></tr>}
              {cdNames.map((name) => (
                <Row
                  key={name}
                  label={name}
                  cells={all.map((p) => {
                    if (!p.sameClass) return OTHER_CLASS;
                    const c = p.s.cooldowns.find((x) => x.name === name);
                    return c ? `${c.uses} / ${c.possible} (${c.times.map(mmss).join(', ')})` : '0';
                  })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>⏳ Cast timeline</h3>
        <p className="muted small">Each tick is a cast (auto attacks excluded). Shaded areas are gaps over 4 seconds; orange dots are major cooldowns.</p>
        <Timeline players={all.map((p) => ({ label: p.me ? 'You' : p.label, snapshot: p.s }))} />
      </section>

      {ref && buffNames.length > 0 && (
        <section className="card">
          <h3>✨ Buff uptime vs {ref.name}</h3>
          {!refSameClass && <p className="muted small">⚠️ Different class: their class-only buffs (stances, forms, auras) are hidden.</p>}
          <div className="scroll">
            <table>
              <thead><tr><th>Buff</th><th className="r">You</th><th className="r">{ref.name}</th></tr></thead>
              <tbody>
                {buffNames
                  .sort((a, b) => ((refBuffs.get(b) ?? 0) - (myBuffs.get(b) ?? 0)) - ((refBuffs.get(a) ?? 0) - (myBuffs.get(a) ?? 0)))
                  .map((name) => {
                    const mine = myBuffs.get(name) ?? 0;
                    const theirs = refBuffs.get(name) ?? 0;
                    return (
                      <tr key={name} className={theirs - mine >= 25 ? 'warn' : ''}>
                        <td>{theirs - mine >= 25 ? '👀 ' : ''}{name}</td><td className="r">{pct(mine)}</td><td className="r">{pct(theirs)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h3>💥 Your damage by ability</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Ability</th><th className="r">Share</th><th className="r">Damage</th><th className="r">Casts</th><th className="r">Avg hit</th><th className="r">Crit</th><th className="r">Miss</th></tr>
            </thead>
            <tbody>
              {me.abilities.map((a) => (
                <tr key={`${a.name}-${a.id}`}>
                  <td>{a.isPet ? '🐾 ' : ''}{a.name}{a.isPet && <span className="muted small"> (pet)</span>}</td>
                  <td className="r">{pct(a.share * 100, 1)}</td>
                  <td className="r">{compact(a.total)}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr>
      <td>{label}</td>
      {cells.map((c, i) => <td key={i} className={c === OTHER_CLASS ? 'r muted small' : 'r'}>{c}</td>)}
    </tr>
  );
}
