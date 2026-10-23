// Past raids.
//   GET              every saved raid with its card (calendar, attendance, progress)
//   GET ?view=home     the home page: guild, next raid, latest raids, highlights, recent analyses
//   GET ?view=profile  the signed-in person's profile and claimed characters
// (One function for all three, to stay within the free Vercel plan's function limit.)
//   POST { url }     officers: add a raid from a Warcraft Logs link; it's saved in full over the next runs
import { waitUntil } from '@vercel/functions';
import { archiveNow, listRaids, registerRaid } from '../server/archive.js';
import { json, readSession, requireSession } from '../server/auth.js';
import { homeData, profileData } from '../server/home.js';
import { auditTask } from '../server/discord/audit.js';
import { requireOfficer } from '../server/officers.js';
import { parseReportUrl } from '../server/wcl.js';

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const view = new URL(req.url).searchParams.get('view');
    if (view === 'home' || view === 'profile') {
      const session = await readSession(req.headers.get('cookie'), process.env.SESSION_SECRET!);
      if (view === 'home') return json(await homeData(session));
      if (!session?.uid) return json({ error: 'Sign in with Discord to see your profile.' }, 403);
      return json(await profileData(session));
    }
    return json(await listRaids());
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const check = await requireOfficer(req);
  if ('denied' in check) return check.denied;
  const { session } = check;
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url) return json({ error: 'Paste a Warcraft Logs link.' }, 400);
    const { host, code } = parseReportUrl(url);
    const raid = await registerRaid({ host, code, source: 'site', addedBy: session.uid ?? null });
    waitUntil(auditTask(`${session.uid ? `<@${session.uid}> (${session.name})` : 'Someone with the guild password'} added ${raid.title ?? code} to Past raids on the site`));
    // Make a start now (the report and first kills), then the 5-minute job carries on
    waitUntil(archiveNow(code, started + 55_000).catch((e) => console.error('saving raid failed', e)));
    return json(raid);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
