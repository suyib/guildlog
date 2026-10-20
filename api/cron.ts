// Posts reminders that are due. Call it every 5 minutes from a free scheduler such as
// cron-job.org: https://guildlog.uk/api/cron?key=YOUR_CRON_SECRET
// (Vercel's own daily schedule in vercel.json is a backup.)
import { postToChannel } from '../server/discord/api.js';
import { reminderMessage } from '../server/discord/commands.js';
import { dueReminders, markReminderSent } from '../server/discord/store.js';

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get('key') ?? req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!secret || key !== secret) return new Response('Not allowed', { status: 401 });

  const due = await dueReminders();
  let sent = 0;
  for (const r of due) {
    try {
      await postToChannel(r.channel_id, reminderMessage(r.payload as Parameters<typeof reminderMessage>[0]));
      sent++;
    } catch (e) {
      console.error('reminder failed', r.id, e);
    }
    await markReminderSent(r.id); // don't retry forever if the channel is gone
  }
  return new Response(`Sent ${sent} of ${due.length} due reminders`, { headers: { 'Content-Type': 'text/plain' } });
}
