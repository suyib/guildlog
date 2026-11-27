// Achievements: praise for a raid night, worked out from its card and the guild's progress. Only
// good news, so they can name people (perfect attendance) and be shown to everyone.
import type { HomeData, RaidCard, ZoneProgress } from '../server/types';
import { mmss } from './format';

export interface Achievement {
  key: string;
  kind: 'Raid' | 'Guild';
  name: string;
  sub: string;
  points: number;
  /** A boss picture for the badge; otherwise a glyph. */
  bossId?: number;
  glyph?: 'check' | 'timer' | 'shield' | 'users' | 'bolt';
}

/** A raid night's achievements, best first. `start` is when the raid began (ms). */
export function raidAchievements(card: RaidCard, opts: { code: string; start: number; zones?: ZoneProgress[] }): Achievement[] {
  const out: Achievement[] = [];
  const bosses = (opts.zones ?? []).flatMap((z) => z.bosses);
  const night = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= opts.start - 60_000 && t <= opts.start + 14 * 3_600_000;
  };
  for (const b of card.bosses.filter((x) => x.kill)) {
    const p = bosses.find((x) => x.encounterId === b.encounterId);
    if (p?.firstKill && night(p.firstKill)) out.push({ key: `first-${b.encounterId}`, kind: 'Guild', name: `${b.name} Down!`, sub: 'The guild’s first kill', points: 25, bossId: b.encounterId });
  }
  if (card.bosses.length >= 2 && card.kills === card.bosses.length) out.push({ key: 'clear', kind: 'Guild', name: 'Full Clear', sub: `All ${card.bosses.length} bosses in one night`, points: 25, glyph: 'check' });
  for (const b of card.bosses.filter((x) => x.kill)) {
    const p = bosses.find((x) => x.encounterId === b.encounterId);
    if (p?.best?.code === opts.code && p.kills > 1 && b.seconds !== null) out.push({ key: `record-${b.encounterId}`, kind: 'Raid', name: `Record: ${b.name}`, sub: `Fastest kill yet, ${mmss(b.seconds)}`, points: 10, bossId: b.encounterId });
  }
  for (const b of card.bosses.filter((x) => x.kill && x.deaths === 0)) {
    out.push({ key: `deathless-${b.encounterId}`, kind: 'Raid', name: `Deathless ${b.name}`, sub: `${b.name} killed with nobody dying`, points: 10, bossId: b.encounterId });
  }
  if (card.kills > 0 && card.wipes === 0) out.push({ key: 'nowipes', kind: 'Raid', name: 'Not a Single Wipe', sub: `Every pull was a kill (${card.kills})`, points: 10, glyph: 'shield' });
  return out;
}

/** Everyone who's been in every raid in the last 8 weeks (at least 3 raids). */
export function attendanceAchievement(roster: HomeData['roster']): Achievement | null {
  const of = roster[0]?.of ?? 0;
  if (of < 3) return null;
  const all = roster.filter((p) => p.raids >= of).map((p) => p.name);
  if (!all.length) return null;
  return { key: 'attendance', kind: 'Guild', name: 'Perfect Attendance', sub: `Every raid in 8 weeks: ${all.slice(0, 6).join(', ')}${all.length > 6 ? ` and ${all.length - 6} more` : ''}`, points: 10, glyph: 'users' };
}
