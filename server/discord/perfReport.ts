// The officers' performance report, built once for both places it's shown: /performance (sent by
// DM) and the site's Performance page. Same rows, same fight summaries, same message.
import { rest } from '../db.js';
import { storedDigests } from '../pack.js';
import { env, type MessageBody } from './api.js';
import { type FightDigest, raidDigest } from './digest.js';
import { type PerfData, type PerfRange, type PerfScope, type Row, RANGE_SCOPE, characterMessage, performanceMessage, performanceRows, rowsFromDigests, summarize } from './performance.js';

export interface PerfRequest {
  range: PerfRange;
  /** A raid (and optionally one fight of it) instead of the range. */
  raid?: { host: string; code: string; fight?: string } | null;
  /** One character instead of everyone. */
  character?: string | null;
}

export interface PerfReport {
  scope: PerfScope;
  body: MessageBody;
  /** Everyone's numbers (not for a single character). */
  data: PerfData | null;
  rows: Row[];
  /** The fight summaries the report read (for active time, cooldowns, consumables…). */
  fights: FightDigest[];
  /** Kills still being read. */
  pending: number;
}

export async function perfReport(req: PerfRequest): Promise<PerfReport> {
  const { range, raid, character } = req;
  const site = env.site();
  if (character) {
    // One character: the raid's kills (stored, or read now), or the range's
    let rows = raid && !raid.fight ? await performanceRows({ code: raid.code }) : [];
    let label = RANGE_SCOPE[range].label;
    let oneNight = RANGE_SCOPE[range].oneNight;
    // Their fight summaries too (active time, cooldowns, potions…), for what could go even better
    let fights: FightDigest[] = [];
    if (raid) {
      oneNight = true;
      const fightId = Number(raid.fight);
      if (!rows.length || fightId > 0) {
        const digest = await raidDigest(raid.host, raid.code);
        fights = fightId > 0 ? digest.fights.filter((f) => f.id === fightId) : digest.fights;
        rows = rowsFromDigests(raid.code, digest.meta.startTime, fights);
        label = fightId > 0 && fights[0] ? `${fights[0].name} (${digest.meta.title})` : digest.meta.title;
      } else {
        label = (await rest(`guild_raids?report_code=eq.${encodeURIComponent(raid.code)}&select=title`).catch(() => null))?.[0]?.title ?? raid.code;
        fights = await storedDigests(raid.code).catch(() => []);
      }
    } else {
      rows = await performanceRows(range);
      const codes = [...new Set(rows.filter((r) => r.name.toLowerCase() === character.toLowerCase()).map((r) => r.report_code))].slice(0, 8);
      fights = (await Promise.all(codes.map((c) => storedDigests(c).catch(() => [])))).flat();
    }
    const scope = { label, oneNight, minKills: 1 };
    return { scope, body: characterMessage(scope, rows, character, site, fights), data: null, rows, fights, pending: 0 };
  }
  if (raid) {
    // A pasted raid (or one fight of it): read from the stored fights, or Warcraft Logs
    const digest = await raidDigest(raid.host, raid.code);
    const fightId = Number(raid.fight);
    const fights = fightId > 0 ? digest.fights.filter((f) => f.id === fightId) : digest.fights;
    if (fightId > 0 && !fights.length) throw new Error('That fight isn’t a boss kill, or it hasn’t been read yet. Try again in a minute, or pick the whole raid.');
    const scope = { label: fightId > 0 ? `${fights[0].name} (${digest.meta.title})` : digest.meta.title, oneNight: true, minKills: fightId > 0 ? 1 : 2 };
    const rows = rowsFromDigests(raid.code, digest.meta.startTime, fights);
    const data = summarize(rows, scope.minKills);
    const body = performanceMessage(scope, data, site);
    if (digest.pending) body.content = `${digest.pending} boss kill${digest.pending === 1 ? ' is' : 's are'} still being read, so ${digest.pending === 1 ? 'it’s' : 'they’re'} not included yet.`;
    return { scope, body, data, rows, fights, pending: digest.pending };
  }
  const scope = RANGE_SCOPE[range];
  const rows = await performanceRows(range);
  const data = summarize(rows, scope.minKills);
  return { scope, body: performanceMessage(scope, data, site), data, rows, fights: [], pending: 0 };
}
