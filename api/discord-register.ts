// Sends the bot's slash commands to Discord. Run once after deploying, and again whenever the
// commands change: open https://guildlog.uk/api/discord-register?key=YOUR_CRON_SECRET
import { discord, env } from '../server/discord/api.js';
import { COMMANDS } from '../server/discord/commands.js';

export async function GET(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return new Response('Not allowed', { status: 401 });
  try {
    const saved = await discord<{ name: string }[]>(`/applications/${env.appId()}/commands`, { method: 'PUT', body: COMMANDS });
    return new Response(`Registered ${saved.length} commands: ${saved.map((c) => '/' + c.name).join(', ')}`, { headers: { 'Content-Type': 'text/plain' } });
  } catch (e) {
    return new Response(`Couldn't register commands: ${(e as Error).message}`, { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }
}
