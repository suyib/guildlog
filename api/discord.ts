// Discord interactions endpoint. Set https://guildlog.uk/api/discord as the
// "Interactions Endpoint URL" in the Discord developer portal.
import { waitUntil } from '@vercel/functions';
import { verifyDiscordRequest } from '../server/discord/api.js';
import { type Interaction, handle } from '../server/discord/commands.js';

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
