// Offline check of the analysis logic with mock WCL-shaped data (modelled on the Magtheridon kill).
import assert from 'node:assert/strict';
import { buildFindings, buildSnapshot, findGaps, possibleUses } from '../server/analysis';
import type { Fight, PlayerTables } from '../server/wcl';

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
    summary: { data: { itemLevel: 113 } },
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
assert.deepEqual(findGaps([5, 6, 20], 22), [{ start: 0, end: 5, seconds: 5 }, { start: 6, end: 20, seconds: 14 }]);

const findings = buildFindings(me, [{ kind: 'same-report', label: 'Muddy (same raid)', snapshot: muddy }]);
for (const f of findings) console.log(`[${f.severity}] ${f.title}\n    ${f.detail}`);
assert.ok(findings.some((f) => f.title.startsWith('Bestial Wrath: 1 of 2')));
assert.ok(findings.some((f) => f.title.includes('Fewer Steady Shot casts')));
assert.ok(findings.some((f) => f.title.includes('Buffs Muddy had')));
console.log('\nAll analysis checks passed.');
