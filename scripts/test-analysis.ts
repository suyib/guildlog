// Offline check of the analysis logic with mock WCL-shaped data (modelled on the Magtheridon kill).
import assert from 'node:assert/strict';
import { buildFindings, buildSnapshot, findGaps, possibleUses } from '../server/analysis';
import type { Fight, PlayerTables } from '../server/wcl';
import { dpsSeriesFrom, survivalFrom } from '../server/dashboard';
import { statTooltip } from '../src/statInfo';
import { cooldownFor } from '../server/cooldowns';

const fight: Fight = { id: 11, encounterID: 651, name: 'Magtheridon', startTime: 0, endTime: 177_000, kill: true, size: 25, difficulty: 3 };
const abilities = new Map<number, string>([[1, 'Steady Shot'], [2, 'Bestial Wrath'], [3, 'Blood Fury'], [4, 'Auto Shot'], [5, 'Arcane Shot']]);

function tables(steady: number, buffs: { name: string; up: number }[]): PlayerTables {
  return {
    dmg: { data: { entries: [
      { name: 'Auto Shot', guid: 4, total: 104_000, hitCount: 80, critHitCount: 20, missCount: 1 },
      { name: 'Steady Shot', guid: 1, total: steady * 1100, hitCount: steady, critHitCount: 10, missCount: 3 },
      { name: 'silah', guid: 99, type: 'Pet', total: 113_000, hitCount: 267, critHitCount: 43 },
    ] } },
    casts: { data: { entries: [{ name: 'Steady Shot', total: steady }, { name: 'Auto Shot', total: 80 }] } },
    buffs: { data: { totalTime: 177_000, auras: buffs.map((b, i) => ({ name: b.name, guid: i, totalUptime: b.up * 1770, totalUses: 1 })) } },
    taken: { data: { entries: [{ name: 'Conflagration', total: 6000 }] } },
    deaths: { data: { entries: [] } },
  };
}

function castEvents(cdTimes: number[], steadyTimes: number[], gapFrom: number, gapTo: number) {
  const ev = [
    ...cdTimes.flatMap((t) => [{ timestamp: t * 1000, type: 'cast', abilityGameID: 2, sourceID: 1 }, { timestamp: t * 1000, type: 'cast', abilityGameID: 3, sourceID: 1 }]),
    ...steadyTimes.filter((t) => t < gapFrom || t > gapTo).map((t) => ({ timestamp: t * 1000, type: 'cast', abilityGameID: 1, sourceID: 1 })),
  ];
  return { events: ev, abilities };
}

const every = (step: number) => Array.from({ length: Math.floor(177 / step) }, (_, i) => 1 + i * step);

const me = buildSnapshot({
  host: 'fresh.warcraftlogs.com', code: 'ABC', fight,
  actor: { id: 28, name: 'Suy', type: 'Player', subType: 'Hunter', petOwner: null },
  fightRow: { icon: 'Hunter-BeastMastery', activeTime: 172_000 },
  rankingRow: { rankPercent: 86, class: 'Hunter', spec: 'BeastMastery' },
  tables: tables(51, [{ name: 'Aspect of the Hawk', up: 99 }]),
  casts: castEvents([91], every(3), 129, 141),
});

const muddy = buildSnapshot({
  host: 'fresh.warcraftlogs.com', code: 'ABC', fight,
  actor: { id: 8, name: 'Muddy', type: 'Player', subType: 'Hunter', petOwner: null },
  fightRow: { icon: 'Hunter-BeastMastery', activeTime: 175_000 },
  rankingRow: { rankPercent: 95, class: 'Hunter', spec: 'BeastMastery' },
  tables: tables(66, [{ name: 'Aspect of the Hawk', up: 99 }, { name: 'Leader of the Pack', up: 72 }, { name: 'Unleashed Rage', up: 45 }]),
  casts: castEvents([17, 148], every(2.5), 999, 999),
});

assert.equal(possibleUses(177, 120), 2);
assert.equal(me.parsePercent, 86);
assert.equal(me.cooldowns.find((c) => c.name === 'Bestial Wrath')?.uses, 1);
assert.ok(me.gaps.some((g) => g.start <= 130 && g.end >= 140), 'expected the 129-141s gap');
assert.deepEqual(findGaps([5, 6, 20], 22), [{ start: 6, end: 20, seconds: 14 }]);
assert.deepEqual(findGaps([12], 13), [{ start: 6, end: 12, seconds: 6 }]);

const findings = buildFindings(me, [{ kind: 'chosen-player', label: 'Muddy (same raid)', snapshot: muddy, sameClass: true }]);
for (const f of findings) console.log(`[${f.severity}] ${f.title}\n    ${f.detail}`);
assert.ok(findings.some((f) => f.title.startsWith('Bestial Wrath: 1 of 2')));
assert.ok(findings.some((f) => f.title.includes('Fewer Steady Shot casts')));
assert.ok(findings.some((f) => f.title.includes('Buffs Muddy had')));
// Cross-class comparison: only general findings, no cast-rate or class buff comparisons
const warrior = { ...muddy, name: 'Stabby', className: 'Warrior', buffs: [{ name: 'Battle Stance', id: 1, uptimePct: 100, uses: 1 }, { name: 'Leader of the Pack', id: 2, uptimePct: 80, uses: 1 }] };
const cross = buildFindings(me, [{ kind: 'chosen-player', label: 'Stabby (Warrior, same raid)', snapshot: warrior, sameClass: false }]);
assert.ok(!cross.some((f) => f.title.startsWith('Fewer')), 'no cast-rate findings across classes');
const buffFinding = cross.find((f) => f.title.startsWith('Buffs'));
assert.ok(buffFinding && !buffFinding.detail.includes('Battle Stance') && buffFinding.detail.includes('Leader of the Pack'));
assert.ok(cross.some((f) => f.title.startsWith('Bestial Wrath: 1 of 2')), 'own cooldown use still checked');

// DPS over time from damage events: report-relative timestamps, aligned to the fight start
const start = 5_000_000;
const events = Array.from({ length: 120 }, (_, i) => ({ timestamp: start + i * 1000, amount: i < 60 ? 2000 : 1000 }));
const series = dpsSeriesFrom(events, start, 120, 1500);
assert.equal(series.length, 120);
assert.ok(series[10].dps > series[100].dps, 'busy first half shows higher DPS');
assert.ok(Math.abs(series.reduce((t, p) => t + p.dps, 0) / 120 - 1500) < 2, 'average matches real DPS');

// Avoidable damage: Fire hit 2 of 8 non-tanks (avoidable), Nova hit everyone (not), Cleave only tanks (not)
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const taken = { data: { entries: ids.map((id) => ({
  id, name: `P${id}`, type: 'Druid', total: 0,
  abilities: [
    { name: 'Nova', total: 1000 },
    ...(id <= 2 ? [{ name: 'Cleave', total: 5000 }] : []),
    ...(id === 3 || id === 4 ? [{ name: 'Fire', total: 3000 }] : []),
  ],
})) } };
for (const e of taken.data.entries) e.total = e.abilities.reduce((t, a) => t + a.total, 0);
const sv = survivalFrom(taken, 3, [1, 2], ids)!;
assert.equal(sv.abilities.find((a) => a.name === 'Fire')?.avoidable, true);
assert.equal(sv.abilities.find((a) => a.name === 'Nova')?.avoidable, false);
assert.equal(sv.avoidableTotal, 3000);
assert.equal(sv.compared, 8);
const tank = survivalFrom(taken, 1, [1, 2], ids)!;
assert.equal(tank.abilities.find((a) => a.name === 'Cleave')?.avoidable, false, 'tank-only damage is not avoidable');

// Stat tooltips explain the stat for the class
assert.ok(statTooltip('Hit', 'Hunter')!.includes('142'));
assert.ok(!/\d/.test(statTooltip('Hit', 'Hunter', false)!));

// Cooldown names match regardless of case and curly apostrophes
assert.equal(cooldownFor('bestial wrath'), 120);
assert.equal(cooldownFor('Celestial Alignment'), undefined);
// Testing period: Mists of Pandaria logs use their own list
assert.equal(cooldownFor('Celestial Alignment', 'classic.warcraftlogs.com'), 180);
assert.equal(cooldownFor('Arcane Power', 'classic.warcraftlogs.com'), 90);
assert.equal(cooldownFor('Arcane Power', 'fresh.warcraftlogs.com'), 180);

console.log('\nAll analysis checks passed.');
