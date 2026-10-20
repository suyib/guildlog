// The Discord bot's one endpoint (the free Vercel plan allows 12 functions, so the bot's jobs share it).
//   POST  Discord interactions. Set https://guildlog.uk/api/discord as the "Interactions Endpoint URL".
//   GET ?task=register&key=CRON_SECRET   sends the slash commands to Discord (run after they change)
//   GET ?task=reminders&key=CRON_SECRET  posts due reminders (call every 5 minutes, e.g. from cron-job.org)
import { waitUntil } from '@vercel/functions';
import { discord, env, postToChannel, verifyDiscordRequest } from '../server/discord/api.js';
import { COMMANDS, type Interaction, handle, reminderMessage } from '../server/discord/commands.js';
import { dueReminders, markReminderSent } from '../server/discord/store.js';

export const maxDuration = 60;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  if (!verifyDiscordRequest(body, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'))) {
    return new Response('Bad request signature', { status: 401 });
  }
  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type === 1) return json({ type: 1 }); // Discord checking the endpoint

  try {
    const outcome = await handle(interaction);
    // Reply within Discord's 3 seconds, then keep working in the background if needed
    if (outcome.after) waitUntil(outcome.after().catch((e) => console.error('discord follow-up failed', e)));
    return json(outcome.response);
  } catch (e) {
    console.error('discord interaction failed', e);
    return json({ type: 4, data: { content: `Something went wrong: ${(e as Error).message}`, flags: 64 } });
  }
}

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  // Vercel's scheduled job sends the secret as a Bearer token; other schedulers use ?key=
  const key = url.searchParams.get('key') ?? req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!secret || key !== secret) return text('Not allowed', 401);

  const task = url.searchParams.get('task') ?? 'reminders'; // Vercel's daily job calls it without a task
  if (task === 'register') {
    try {
      const saved = await discord<{ name: string }[]>(`/applications/${env.appId()}/commands`, { method: 'PUT', body: COMMANDS });
      return text(`Registered ${saved.length} commands: ${saved.map((c) => '/' + c.name).join(', ')}`);
    } catch (e) {
      return text(`Couldn't register commands: ${(e as Error).message}`, 500);
    }
  }
  if (task === 'reminders') {
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
    return text(`Sent ${sent} of ${due.length} due reminders`);
  }
  return text('Unknown task', 400);
}
