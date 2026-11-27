// "What this means": a few plain-English lines under each chart or table on an analysis, worked
// out from the numbers (not a description of the chart). Kept short: the biggest thing first.
import type { Healing, PlayerSnapshot, Survival } from '../server/types';
import { compact, mmss } from './format';
import { ADVICE, LIMITS } from '../server/coach';

const AUTO = /^(Auto Shot|Shoot|Melee|Auto Attack|Attack)$/;

/** One line, with the icon of the spell it's about when there is one. */
export interface Line { text: string; icon?: string }

/** A spell's icon from the analysis (abilities, cooldowns, buffs), by name. */
function iconOf(me: PlayerSnapshot, name: string | undefined): string | undefined {
  if (!name) return undefined;
  return me.abilities.find((a) => a.name === name)?.icon ?? me.cooldowns.find((c) => c.name === name)?.icon ?? me.buffs.find((b) => b.name === name)?.icon
    ?? (me.healing?.abilities ?? []).find((a) => a.name === name)?.icon;
}
const L = (text: string, icon?: string): Line => (icon ? { text, icon } : { text });
const r0 = (v: number) => Math.round(v);

/** The cast timeline: how much of the fight you were casting, and where the gaps were. */
export function rotationTakeaway(me: PlayerSnapshot, ref?: PlayerSnapshot | null): Line[] {
  const out: Line[] = [];
  const gaps = me.gaps ?? [];
  const lost = gaps.reduce((t, g) => t + g.seconds, 0);
  const active = me.activePct;
  if (!gaps.length) out.push(L(`No gaps over ${LIMITS.gapSeconds} seconds: you kept casting the whole fight${active !== null ? ` (${r0(active)}% active)` : ''}. That's the foundation of good damage.`));
  else {
    const longest = gaps.reduce((a, g) => (g.seconds > a.seconds ? g : a));
    out.push(L(`${gaps.length} gap${gaps.length > 1 ? 's' : ''} over ${LIMITS.gapSeconds} seconds added up to ${r0(lost)}s of ${mmss(me.fightSeconds)} (the longest was ${r0(longest.seconds)}s at ${mmss(longest.start)}). ${ADVICE.active}`));
  }
  if (ref && ref.activePct !== null && active !== null && Math.abs(ref.activePct - active) >= 3) {
    out.push(L(`${ref.name} was active ${r0(ref.activePct)}% of their fight against your ${r0(active)}%.`));
  }
  if (me.fightSeconds < 60) out.push(L(`${mmss(me.fightSeconds)}: ${ADVICE.opener}`));
  return out;
}

/** Cooldowns: used as often as the fight allowed, and how soon. */
export function cooldownTakeaway(me: PlayerSnapshot): Line[] {
  const cds = me.cooldowns ?? [];
  if (!cds.length) return [L('No big cooldowns were tracked for you on this fight.')];
  const missed = cds.filter((c) => c.possible > c.uses);
  const first = Math.min(...cds.flatMap((c) => c.times).filter((t) => Number.isFinite(t)), Infinity);
  const out: Line[] = [];
  if (!missed.length) out.push(L(`Every cooldown went out as often as the fight allowed${Number.isFinite(first) ? `, the first at ${mmss(first)}` : ''}. Nothing to gain here.`, cds[0].icon));
  else out.push(L(`${missed.map((c) => `${c.name} ${c.uses} of ${c.possible}`).join(', ')}. Each missed use is a window of extra damage you didn't get. ${ADVICE.cooldowns}`, missed[0].icon ?? iconOf(me, missed[0].name)));
  if (Number.isFinite(first) && first > 10) out.push(L(`Your first cooldown was at ${mmss(first)}. ${ADVICE.cooldownsLate}`));
  return out;
}

/** Casts per minute: your main spells, and the biggest difference with whoever you compared against. */
export function castsTakeaway(me: PlayerSnapshot, ref?: PlayerSnapshot | null): Line[] {
  const mine = Object.entries(me.castsPerMinute).filter(([n]) => !AUTO.test(n)).sort((a, b) => b[1] - a[1]);
  if (!mine.length) return [];
  const [top, rate] = mine[0];
  const out: Line[] = [L(`Your most-cast spell was ${top}: ${rate.toFixed(1)} a minute, about one every ${(60 / rate).toFixed(1)} seconds.`, iconOf(me, top))];
  if (ref) {
    const names = new Set([...mine.map(([n]) => n), ...Object.keys(ref.castsPerMinute).filter((n) => !AUTO.test(n))]);
    const diffs = [...names].map((n) => ({ n, a: me.castsPerMinute[n] ?? 0, b: ref.castsPerMinute[n] ?? 0 })).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));
    const d = diffs[0];
    if (d && Math.abs(d.b - d.a) >= 0.5) out.push(L(`The biggest difference with ${ref.name}: ${d.n}, ${d.a.toFixed(1)} a minute for you and ${d.b.toFixed(1)} for them. That's usually where a rotation differs most.`, iconOf(me, d.n) ?? iconOf(ref, d.n)));
  }
  return out;
}

/** Where your damage came from: the top spells, the pet, and misses. */
export function damageTakeaway(me: PlayerSnapshot, ref?: PlayerSnapshot | null): Line[] {
  const list = me.abilities;
  if (!list.length) return [];
  const out: Line[] = [];
  const top = list[0];
  const top3 = list.slice(0, 3).reduce((t, a) => t + a.share, 0);
  out.push(L(`${top.name} did ${r0(top.share * 100)}% of your damage, and your top 3 spells ${r0(top3 * 100)}%. Those are the ones to get right first.`, top.icon));
  const pet = list.filter((a) => a.isPet).reduce((t, a) => t + a.share, 0);
  if (pet >= 0.1) out.push(L(`Your pet did ${r0(pet * 100)}%: keeping it alive and attacking matters.`));
  const missy = list.filter((a) => !a.isPet && (a.missPct ?? 0) >= LIMITS.missPct && (me.castCounts[a.name] ?? a.casts) >= LIMITS.missCasts).sort((a, b) => (b.missPct ?? 0) - (a.missPct ?? 0));
  if (missy.length) out.push(L(`${missy[0].name} missed ${r0(missy[0].missPct!)}% of the time. ${ADVICE.misses}`, missy[0].icon));
  if (ref?.abilities.length) {
    const theirs = new Map(ref.abilities.map((a) => [a.name, a.share]));
    const d = list.slice(0, 6).filter((a) => theirs.has(a.name)).map((a) => ({ n: a.name, a: a.share, b: theirs.get(a.name)! })).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))[0];
    if (d && Math.abs(d.b - d.a) >= 0.05) out.push(L(`${d.n} was ${r0(d.a * 100)}% of your damage and ${r0(d.b * 100)}% of ${ref.name}'s.`, iconOf(me, d.n)));
  }
  return out;
}

/** Where your healing came from, and how much went to waste. */
export function healingTakeaway(h: Healing): Line[] {
  if (!h.abilities.length) return [];
  const out: Line[] = [];
  const top = h.abilities[0];
  out.push(L(`${top.name} did ${r0(top.share * 100)}% of your healing${h.overhealPct !== null ? `, and ${r0(h.overhealPct)}% of everything you cast overhealed` : ''}.`, top.icon));
  const waste = h.abilities.filter((a) => (a.overhealPct ?? 0) >= LIMITS.overhealSpell && a.share >= LIMITS.overhealSpellShare).sort((a, b) => (b.overhealPct ?? 0) - (a.overhealPct ?? 0));
  if (waste.length) out.push(L(`${waste[0].name} overhealed ${r0(waste[0].overhealPct!)}%. ${ADVICE.overhealSpell}`, waste[0].icon));
  else if ((h.overhealPct ?? 0) <= LIMITS.overhealLow) out.push(L('Very little overhealing: your heals were landing where they were needed.'));
  return out;
}

/** Damage taken: deaths, avoidable damage, and against the raid. */
export function survivalTakeaway(me: PlayerSnapshot, sv?: Survival): Line[] {
  const out: Line[] = [];
  const total = sv?.total ?? me.damageTaken.reduce((t, x) => t + x.total, 0);
  if (me.deaths.length) out.push(L(`You died at ${me.deaths.map((d) => mmss(d.seconds)).join(', ')}${me.deaths[0].by ? ` (${me.deaths[0].by})` : ''}. ${ADVICE.death}`, 'spell_holy_resurrection'));
  if (sv) {
    const share = total > 0 ? sv.avoidableTotal / total : 0;
    const worst = sv.abilities.filter((a) => a.avoidable).sort((a, b) => b.total - a.total)[0];
    if (share >= 0.1 && worst) out.push(L(`${r0(share * 100)}% of the damage you took was likely avoidable, most of it ${worst.name} (${compact(worst.total)}). ${ADVICE.avoidable}`, worst.icon));
    else if (!me.deaths.length) out.push(L(`Hardly any avoidable damage, and you took ${total <= sv.raidMedianTotal ? 'less' : 'more'} than the typical ${sv.isTank ? 'tank' : 'raider'} on this fight.`));
  }
  if (!out.length) out.push(L('You survived the whole fight.'));
  return out;
}
