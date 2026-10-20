// Plain-language "what went well / what to work on" for a whole raid: one fight (the site's fight
// breakdown) or every boss in a night (the Discord /raidend summary). Written for people who don't
// read logs, so it talks about deaths, standing in bad, staying busy and cooldowns, not numbers.
// Things to work on never name anyone; only praise does (on the site, not in Discord).
import type { FightDigest, PlayerDigest } from './discord/digest.js';
import type { RaidFeedback, RaidPoint } from './types.js';

export interface RaidFeedbackOptions {
  /** Wipes before kills, by boss name (whole-raid summaries). */
  wipes?: { boss: string; count: number }[];
  /** When Bloodlust/Heroism went out in the fight, seconds from the pull (single-fight breakdowns). */
  bloodlust?: number[];
  /** Leave out the list of kills (when it's already shown elsewhere, like the Discord summary). */
  skipKills?: boolean;
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s)) % 60).padStart(2, '0')}`;
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function raidFeedback(fights: FightDigest[], opts: RaidFeedbackOptions = {}): RaidFeedback {
  const good: RaidPoint[] = [];
  const work: RaidPoint[] = [];
  if (!fights.length) return { good, work };
  const single = fights.length === 1;
  const where = single ? '' : ` across ${plural(fights.length, 'boss', 'bosses')}`;
  const rows = fights.flatMap((f) => f.players.map((p) => ({ f, p })));
  const people = (pred: (p: PlayerDigest, f: FightDigest) => boolean) => [...new Set(rows.filter(({ p, f }) => pred(p, f)).map(({ p }) => p.name))];

  // ---- Kills and speed ----
  if (single) {
    const f = fights[0];
    if (f.kill) good.push({ title: `${f.name} down in ${mmss(f.seconds)}`, detail: 'A clean kill is the goal; everything below is about making the next one smoother.' });
  } else if (!opts.skipKills) {
    good.push({ title: `${plural(fights.length, 'boss', 'bosses')} killed`, detail: fights.map((f) => `${f.name} (${mmss(f.seconds)})`).join(', ') + '.' });
  }
  const wipes = (opts.wipes ?? []).filter((w) => w.count > 0);
  if (wipes.length) {
    const total = wipes.reduce((t, w) => t + w.count, 0);
    work.push({ title: `${plural(total, 'wipe')} along the way`, detail: `${wipes.map((w) => `${w.boss}: ${w.count}`).join(', ')}. Worth a quick chat about what went wrong on those pulls.` });
  }

  // ---- Deaths ----
  const deaths = rows.flatMap(({ f, p }) => p.deaths.map((d) => ({ boss: f.name, name: p.name, by: d.by, at: d.seconds })));
  if (!deaths.length) good.push({ title: 'Nobody died', detail: `Everyone survived${where}. That's the biggest single thing a raid can do for its damage.` });
  else {
    const byCause = new Map<string, string[]>();
    for (const d of deaths) byCause.set(d.by, [...(byCause.get(d.by) ?? []), d.name]);
    const [topCause, victims] = [...byCause].sort((a, b) => b[1].length - a[1].length)[0];
    work.push({
      title: `${plural(deaths.length, 'death')}${where}`,
      detail: byCause.size === 1 || victims.length > 1
        ? `Most were to ${topCause} (${victims.length}). Learning that mechanic is the quickest win.`
        : `Killed by: ${[...byCause.keys()].slice(0, 4).join(', ')}.`,
    });
  }

  // ---- Standing in avoidable damage (non-tanks) ----
  const nonTank = rows.filter(({ p }) => p.role !== 'tank');
  const taken = nonTank.reduce((t, { p }) => t + p.taken, 0);
  const avoidable = nonTank.reduce((t, { p }) => t + p.avoidable, 0);
  const sources = new Map<string, number>();
  for (const { p } of nonTank) for (const a of p.avoidableTop) sources.set(a.name, (sources.get(a.name) ?? 0) + a.total);
  if (taken > 0) {
    const share = avoidable / taken;
    if (share < 0.05) good.push({ title: 'Very little avoidable damage', detail: 'The raid stayed out of the things you can move away from.' });
    else if (sources.size) {
      const [name, amount] = [...sources].sort((a, b) => b[1] - a[1])[0];
      work.push({
        title: `Avoidable damage: ${name}`,
        detail: `${compact(amount)} damage from ${name}, which most of the raid avoided. ${share >= 0.15 ? 'It made up a big part of the healing needed.' : 'Moving out sooner keeps people alive and casting.'}`,
      });
    }
  }

  // ---- Staying busy ----
  const active = rows.map(({ p }) => p.activePct).filter((v): v is number => v !== null);
  const avgActive = active.length ? active.reduce((t, v) => t + v, 0) / active.length : null;
  const idle = people((p) => p.role !== 'healer' && p.activePct !== null && p.activePct < 85);
  if (avgActive !== null && avgActive >= 92 && !idle.length) good.push({ title: 'Everyone kept attacking', detail: `${avgActive.toFixed(0)}% average active time; very little standing around.` });
  if (idle.length) work.push({ title: `${plural(idle.length, 'player')} spent a lot of time not attacking`, detail: 'More than 15% of the fight with nothing being cast. Often it’s movement; casting while moving or pre-positioning helps.' });

  // ---- Cooldowns ----
  const withCds = rows.filter(({ p }) => p.cooldowns.length);
  if (withCds.length) {
    const under = people((p) => p.cooldowns.some((c) => c.uses < c.possible));
    if (!under.length) good.push({ title: 'Cooldowns used on time', detail: 'Everyone pressed their big damage cooldowns as often as the fight allowed.' });
    else work.push({ title: `${plural(under.length, 'player')} could use cooldowns more`, detail: 'Big cooldowns should go out at the pull and again as soon as they’re ready.' });
  }

  // ---- Parses ----
  // Damage parses only: healers' digest parses are for damage, which isn't their job
  const ranked = (p: PlayerDigest) => p.role !== 'healer' && p.parse !== null;
  if (rows.some(({ p }) => ranked(p))) {
    const strong = people((p) => ranked(p) && p.parse! >= 75);
    const weak = people((p) => ranked(p) && p.parse! < 25);
    if (strong.length) good.push({ title: `${plural(strong.length, 'strong performance')}`, detail: 'Parsed 75 or higher, better than most players of the same spec on that boss.', who: strong });
    if (weak.length) work.push({ title: `${plural(weak.length, 'player')} well below their spec`, detail: 'Parsed under 25. A look at their own summary (or a chat about rotation and gear) will help most.' });
  }

  // ---- Bloodlust (single fight) ----
  if (opts.bloodlust) {
    if (!opts.bloodlust.length) work.push({ title: 'No Bloodlust or Heroism', detail: 'Using it at the pull (or the hardest phase) is one of the biggest damage boosts available.' });
    else if (opts.bloodlust[0] <= 20) good.push({ title: 'Bloodlust at the pull', detail: `Went out at ${mmss(opts.bloodlust[0])}, lining up with everyone's cooldowns.` });
  }

  return { good: good.slice(0, 6), work: work.slice(0, 6) };
}
