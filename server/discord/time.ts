// Turning "20:00 tomorrow" in the guild's timezone into a UTC time.

/** Minutes the timezone is ahead of UTC at a given moment. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return Math.round((local - at.getTime()) / 60_000);
}

function localToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - offsetMinutes(new Date(guess), tz) * 60_000;
  utc = guess - offsetMinutes(new Date(utc), tz) * 60_000; // second pass handles clock changes
  return new Date(utc);
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parse a time ("20:00", "8pm", "8:30pm") and an optional day ("today", "tomorrow", "friday",
 * "2026-10-24", "24/10"). Without a day, the next time it's that time. Returns null if unreadable.
 */
export function parseWhen(time: string, day: string | undefined, tz: string, now = new Date()): Date | null {
  const t = time.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!t) return null;
  let hh = Number(t[1]);
  const mm = Number(t[2] ?? 0);
  if (t[3] === 'pm' && hh < 12) hh += 12;
  if (t[3] === 'am' && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return null;

  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number);
  const [ty, tm, td] = todayParts;
  const weekday = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
  const addDays = (n: number) => {
    const x = new Date(Date.UTC(ty, tm - 1, td + n));
    return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()] as const;
  };

  const dRaw = day?.trim().toLowerCase();
  let ymd: readonly [number, number, number];
  if (!dRaw) {
    const today = localToUtc(ty, tm, td, hh, mm, tz);
    ymd = today.getTime() > now.getTime() ? [ty, tm, td] : addDays(1);
  } else if (dRaw === 'today') ymd = [ty, tm, td];
  else if (dRaw === 'tomorrow') ymd = addDays(1);
  else if (DAYS.some((d) => d.startsWith(dRaw.slice(0, 3)))) {
    const target = DAYS.findIndex((d) => d.startsWith(dRaw.slice(0, 3)));
    let diff = (target - weekday + 7) % 7;
    if (diff === 0 && localToUtc(ty, tm, td, hh, mm, tz).getTime() <= now.getTime()) diff = 7;
    ymd = addDays(diff);
  } else {
    const iso = dRaw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const uk = dRaw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (iso) ymd = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (uk) ymd = [uk[3] ? Number(uk[3].length === 2 ? `20${uk[3]}` : uk[3]) : ty, Number(uk[2]), Number(uk[1])];
    else return null;
  }
  return localToUtc(ymd[0], ymd[1], ymd[2], hh, mm, tz);
}
