// "What this means": a few plain-English lines under each chart or table on an analysis, worked
// out from the numbers (not a description of the chart). Kept short: the biggest thing first.
import type { Healing, PlayerSnapshot, Survival } from '../server/types';
import { compact, mmss } from './format';

const AUTO = /^(Auto Shot|Shoot|Melee|Auto Attack|Attack)$/;
const r0 = (v: number) => Math.round(v);

/** The cast timeline: how much of the fight you were casting, and where the gaps were. */
export function rotationTakeaway(me: PlayerSnapshot, ref?: PlayerSnapshot | null): string[] {
  const out: string[] = [];
  const gaps = me.gaps ?? [];
  const lost = gaps.reduce((t, g) => t + g.seconds, 0);
  const active = me.activePct;
  if (!gaps.length) out.push(`No gaps over 4 seconds: you kept casting the whole fight${active !== null ? ` (${r0(active)}% active)` : ''}. That's the foundation of good damage.`);
  else {
    const longest = gaps.reduce((a, g) => (g.seconds > a.seconds ? g : a));
    out.push(`${gaps.length} gap${gaps.length > 1 ? 's' : ''} over 4 seconds added up to ${r0(lost)}s of ${mmss(me.fightSeconds)} (the longest was ${r0(longest.seconds)}s at ${mmss(longest.start)}). Gaps are usually the easiest damage to win back: casting while moving, or being in place before the boss moves you.`);
  }
  if (ref && ref.activePct !== null && active !== null && Math.abs(ref.activePct - active) >= 3) {
    out.push(`${ref.name} was active ${r0(ref.activePct)}% of their fight against your ${r0(active)}%.`);
  }
  if (me.fightSeconds < 60) out.push(`A short fight (${mmss(me.fightSeconds)}), so the opener matters most: cooldowns and your strongest spells right at the pull.`);
  return out;
}

/** Cooldowns: used as often as the fight allowed, and how soon. */
export function cooldownTakeaway(me: PlayerSnapshot): string[] {
  const cds = me.cooldowns ?? [];
  if (!cds.length) return ['No big cooldowns were tracked for you on this fight.'];
  const missed = cds.filter((c) => c.possible > c.uses);
  const first = Math.min(...cds.flatMap((c) => c.times).filter((t) => Number.isFinite(t)), Infinity);
  const out: string[] = [];
  if (!missed.length) out.push(`Every cooldown went out as often as the fight allowed${Number.isFinite(first) ? `, the first at ${mmss(first)}` : ''}. Nothing to gain here.`);
  else out.push(`${missed.map((c) => `${c.name} ${c.uses} of ${c.possible}`).join(', ')}. Each missed use is a window of extra damage you didn't get; unless the fight needs them saved, use them again as soon as they're ready.`);
  if (Number.isFinite(first) && first > 10) out.push(`Your first cooldown was at ${mmss(first)}. On most bosses using them at the pull gives an extra use by the end.`);
  return out;
}

/** Casts per minute: your main spells, and the biggest difference with whoever you compared against. */
export function castsTakeaway(me: PlayerSnapshot, ref?: PlayerSnapshot | null): string[] {
  const mine = Object.entries(me.castsPerMinute).filter(([n]) => !AUTO.test(n)).sort((a, b) => b[1] - a[1]);
  if (!mine.length) return [];
  const [top, rate] = mine[0];
  const out = [`Your most-cast spell was ${top}: ${rate.toFixed(1)} a minute, about one every ${(60 / rate).toFixed(1)} seconds.`];
  if (ref) {
    const names = new Set([...mine.map(([n]) => n), ...Object.keys(ref.castsPerMinute).filter((n) => !AUTO.test(n))]);
    const diffs = [...names].map((n) => ({ n, a: me.castsPerMinute[n] ?? 0, b: ref.castsPerMinute[n] ?? 0 })).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));
    const d = diffs[0];
    if (d && Math.abs(d.b - d.a) >= 0.5) out.push(`The biggest difference with ${ref.name}: ${d.n}, ${d.a.toFixed(1)} a minute for you and ${d.b.toFixed(1)} for them. That's usually where a rotation differs most.`);
  }
  return out;
}

/** Where your damage came from: the top spells, the pet, and misses. */
export function damageTakeaway(me: PlayerSnapshot, ref?: PlayerSnapshot | null): string[] {
  const list = me.abilities;
  if (!list.length) return [];
  const out: string[] = [];
  const top = list[0];
  const top3 = list.slice(0, 3).reduce((t, a) => t + a.share, 0);
  out.push(`${top.name} did ${r0(top.share * 100)}% of your damage, and your top 3 spells ${r0(top3 * 100)}%. Those are the ones to get right first.`);
  const pet = list.filter((a) => a.isPet).reduce((t, a) => t + a.share, 0);
  if (pet >= 0.1) out.push(`Your pet did ${r0(pet * 100)}%: keeping it alive and attacking matters.`);
  const missy = list.filter((a) => !a.isPet && (a.missPct ?? 0) >= 5 && a.share >= 0.05).sort((a, b) => (b.missPct ?? 0) - (a.missPct ?? 0));
  if (missy.length) out.push(`${missy[0].name} missed ${r0(missy[0].missPct!)}% of the time. More hit rating turns those into damage.`);
  if (ref?.abilities.length) {
    const theirs = new Map(ref.abilities.map((a) => [a.name, a.share]));
    const d = list.slice(0, 6).filter((a) => theirs.has(a.name)).map((a) => ({ n: a.name, a: a.share, b: theirs.get(a.name)! })).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))[0];
    if (d && Math.abs(d.b - d.a) >= 0.05) out.push(`${d.n} was ${r0(d.a * 100)}% of your damage and ${r0(d.b * 100)}% of ${ref.name}'s.`);
  }
  return out;
}

/** Where your healing came from, and how much went to waste. */
export function healingTakeaway(h: Healing): string[] {
  if (!h.abilities.length) return [];
  const out: string[] = [];
  const top = h.abilities[0];
  out.push(`${top.name} did ${r0(top.share * 100)}% of your healing${h.overhealPct !== null ? `, and ${r0(h.overhealPct)}% of everything you cast overhealed` : ''}.`);
  const waste = h.abilities.filter((a) => (a.overhealPct ?? 0) >= 40 && a.share >= 0.1).sort((a, b) => (b.overhealPct ?? 0) - (a.overhealPct ?? 0));
  if (waste.length) out.push(`${waste[0].name} overhealed ${r0(waste[0].overhealPct!)}%. Casting it a little later, a smaller rank, or on someone lower usually turns that into real healing.`);
  else if ((h.overhealPct ?? 0) < 25) out.push('Very little overhealing: your heals were landing where they were needed.');
  return out;
}

/** Damage taken: deaths, avoidable damage, and against the raid. */
export function survivalTakeaway(me: PlayerSnapshot, sv?: Survival): string[] {
  const out: string[] = [];
  const total = sv?.total ?? me.damageTaken.reduce((t, x) => t + x.total, 0);
  if (me.deaths.length) out.push(`You died at ${me.deaths.map((d) => mmss(d.seconds)).join(', ')}${me.deaths[0].by ? ` (${me.deaths[0].by})` : ''}. Everything after that is lost damage, so surviving comes first.`);
  if (sv) {
    const share = total > 0 ? sv.avoidableTotal / total : 0;
    const worst = sv.abilities.filter((a) => a.avoidable).sort((a, b) => b.total - a.total)[0];
    if (share >= 0.1 && worst) out.push(`${r0(share * 100)}% of the damage you took was likely avoidable, most of it ${worst.name} (${compact(worst.total)}). Fewer of those hits saves your healers mana.`);
    else if (!me.deaths.length) out.push(`Hardly any avoidable damage, and you took ${total <= sv.raidMedianTotal ? 'less' : 'more'} than the typical ${sv.isTank ? 'tank' : 'raider'} on this fight.`);
  }
  if (!out.length) out.push('You survived the whole fight.');
  return out;
}
