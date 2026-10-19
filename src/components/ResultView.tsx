import type { AnalysisResult, PlayerSnapshot } from '../../server/types';
import { compact, mmss, n0, pct } from '../format';
import Timeline from './Timeline';

export default function ResultView({ result }: { result: AnalysisResult }) {
  const { player: me, comparisons, findings, notes } = result;
  const all: { label: string; s: PlayerSnapshot; me?: boolean }[] = [
    { label: 'You', s: me, me: true },
    ...comparisons.map((c) => ({ label: c.label, s: c.snapshot })),
  ];

  // Union of top abilities by cast count, for the cast comparison table
  const castNames = Array.from(
    new Set(all.flatMap((p) => p.s.abilities.filter((a) => !a.isPet && a.casts > 0).slice(0, 6).map((a) => a.name))),
  ).slice(0, 8);
  const cdNames = Array.from(new Set(all.flatMap((p) => p.s.cooldowns.map((c) => c.name))));
  const ref = comparisons[0]?.snapshot;
  const myBuffs = new Map(me.buffs.map((b) => [b.name, b.uptimePct]));
  const refBuffs = new Map((ref?.buffs ?? []).map((b) => [b.name, b.uptimePct]));
  const buffNames = Array.from(new Set([...me.buffs, ...(ref?.buffs ?? [])].filter((b) => b.uptimePct >= 20).map((b) => b.name)));
  const reportLink = `https://${me.host}/reports/${me.reportCode}?fight=${me.fightId}`;

  return (
    <>
      <section className="card">
        <div className="head">
          <div>
            <h2>{me.name} <span className="muted">{me.specName} {me.className}</span></h2>
            <div className="muted small">
              {me.encounterName} · {me.kill ? 'Kill' : 'Wipe'} · {mmss(me.fightSeconds)} · <a href={reportLink} target="_blank" rel="noreferrer">open on Warcraft Logs</a>
            </div>
          </div>
          <div className="stats">
            <Stat label="DPS" value={n0(me.dps)} />
            <Stat label="Parse" value={me.parsePercent === null ? '–' : String(Math.round(me.parsePercent))} />
            <Stat label="Active" value={pct(me.activePct)} />
            <Stat label="Item level" value={me.itemLevel ? String(me.itemLevel) : '–'} />
          </div>
        </div>
      </section>

      <section className="card">
        <h3>What to work on</h3>
        {findings.length === 0 && <p className="muted">Nothing stood out against the comparisons. Nice.</p>}
        <ol className="findings">
          {findings.map((f, i) => (
            <li key={i} className={`sev-${f.severity}`}>
              <strong>{f.title}</strong>
              <p>{f.detail}</p>
            </li>
          ))}
        </ol>
        {notes.length > 0 && <p className="muted small">{notes.join(' · ')}</p>}
      </section>

      <section className="card">
        <h3>Side by side</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr><th></th>{all.map((p) => <th key={p.label} className="r">{p.me ? 'You' : p.label}</th>)}</tr>
            </thead>
            <tbody>
              <Row label="DPS" cells={all.map((p) => n0(p.s.dps))} />
              <Row label="Parse" cells={all.map((p) => (p.s.parsePercent === null ? '–' : String(Math.round(p.s.parsePercent))))} />
              <Row label="Fight length" cells={all.map((p) => mmss(p.s.fightSeconds))} />
              <Row label="Active time" cells={all.map((p) => pct(p.s.activePct))} />
              <Row label="Item level" cells={all.map((p) => (p.s.itemLevel ? String(p.s.itemLevel) : '–'))} />
              <Row label="Time with no casts" cells={all.map((p) => `${Math.round(p.s.gaps.reduce((s, g) => s + g.seconds, 0))}s`)} />
              <tr className="group"><td colSpan={all.length + 1}>Casts per minute</td></tr>
              {castNames.map((name) => (
                <Row key={name} label={name} cells={all.map((p) => (p.s.castsPerMinute[name] ? p.s.castsPerMinute[name].toFixed(1) : '–'))} />
              ))}
              {cdNames.length > 0 && <tr className="group"><td colSpan={all.length + 1}>Cooldown uses (used / possible)</td></tr>}
              {cdNames.map((name) => (
                <Row
                  key={name}
                  label={name}
                  cells={all.map((p) => {
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
        <h3>Cast timeline</h3>
        <p className="muted small">Each tick is a cast (auto attacks excluded). Shaded areas are gaps over 4 seconds.</p>
        <Timeline players={all.map((p) => ({ label: p.me ? 'You' : p.label, snapshot: p.s }))} />
      </section>

      {ref && buffNames.length > 0 && (
        <section className="card">
          <h3>Buff uptime vs {ref.name}</h3>
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
                        <td>{name}</td><td className="r">{pct(mine)}</td><td className="r">{pct(theirs)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h3>Your damage by ability</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Ability</th><th className="r">Share</th><th className="r">Damage</th><th className="r">Casts</th><th className="r">Avg hit</th><th className="r">Crit</th><th className="r">Miss</th></tr>
            </thead>
            <tbody>
              {me.abilities.map((a) => (
                <tr key={`${a.name}-${a.id}`}>
                  <td>{a.name}{a.isPet && <span className="muted small"> (pet)</span>}</td>
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
      {cells.map((c, i) => <td key={i} className="r">{c}</td>)}
    </tr>
  );
}
