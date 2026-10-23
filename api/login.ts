// Signing in and out (this endpoint is open; everything else needs a session).
//   GET  ?discord=1&next=/path   start "Sign in with Discord"
//   GET  ?code=…&state=…         Discord sends people back here after they approve
//   GET  ?me=1                   who's signed in (for the menu)
//   GET  ?logout=1               sign out
//   POST password=…&next=…       the guild password (while APP_PASSWORD is set)
import { clearSessionCookie, json, passwordMatches, readCookie, readSession, sessionCookie, sign, unsign } from '../server/auth.js';
import { env } from '../server/discord/api.js';
import { auditTask } from '../server/discord/audit.js';
import { discordLoginEnabled, isSiteAdmin, membership } from '../server/officers.js';
import { RANK_LABEL, type Rank, discordRank, effectiveRank, level, storedPerson } from '../server/ranks.js';
import { recordSignIn } from '../server/users.js';

const STATE_COOKIE = 'gl_oauth';
const redirectUri = () => `${env.site()}/api/login`;

/** Only same-site paths like /a/<id>, so sign-in can't be used to send people elsewhere. */
const safeNext = (raw: string | null | undefined) => {
  const n = String(raw ?? '/');
  return n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') && !n.startsWith('/api/') ? n : '/';
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = process.env.SESSION_SECRET;
  if (!secret) return new Response('Server is missing SESSION_SECRET', { status: 500 });

  if (url.searchParams.has('me')) {
    const s = await readSession(req.headers.get('cookie'), secret);
    // Rank from the stored profile (cheap); officer-only actions still check Discord live
    const stored = s?.uid ? await storedPerson(s.uid) : null;
    const rank: Rank | null = !s ? null : s.kind === 'discord' ? effectiveRank(s.uid, stored?.rank, stored?.discord_rank ?? (s.officer ? 'officer' : 'raider')) : discordLoginEnabled() ? 'raider' : 'officer';
    return json({
      signedIn: !!s,
      kind: s?.kind ?? null,
      name: stored?.display_name || s?.name || null,
      avatar: s?.uid && s.avatar ? `https://cdn.discordapp.com/avatars/${s.uid}/${s.avatar}.png?size=64` : null,
      rank,
      officer: !!rank && level(rank) >= level('officer'),
      admin: isSiteAdmin(s),
      discordLogin: discordLoginEnabled(),
    }, 200, { 'Cache-Control': 'no-store' });
  }

  if (url.searchParams.has('logout')) {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': clearSessionCookie() } });
  }

  if (url.searchParams.has('discord')) {
    if (!discordLoginEnabled()) return page('Discord sign-in isn’t set up', 'Add DISCORD_CLIENT_SECRET in Vercel (see the README), then redeploy.');
    // A one-time value kept in a short cookie and in the state, so the reply can only finish a sign-in this browser started
    const nonce = crypto.randomUUID();
    const state = await sign(secret, `${nonce}|${Date.now() + 10 * 60_000}|${safeNext(url.searchParams.get('next'))}`);
    const auth = new URL('https://discord.com/oauth2/authorize');
    auth.search = new URLSearchParams({ client_id: env.appId(), redirect_uri: redirectUri(), response_type: 'code', scope: 'identify', state, prompt: 'none' }).toString();
    return new Response(null, {
      status: 303,
      headers: { Location: auth.toString(), 'Set-Cookie': `${STATE_COOKIE}=${nonce}; Path=/api/login; HttpOnly; Secure; SameSite=Lax; Max-Age=600` },
    });
  }

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (url.searchParams.get('error')) return page('Sign-in cancelled', 'Discord sign-in was cancelled.', true);
  if (!code || !stateRaw) return new Response(null, { status: 303, headers: { Location: '/' } });

  // Check the state: signed by us, recent, and started in this browser
  const state = await unsign(secret, stateRaw);
  const [nonce, expires, next] = (state ?? '').split('|');
  if (!state || Number(expires) < Date.now() || nonce !== readCookie(req.headers.get('cookie'), STATE_COOKIE)) {
    return page('Sign-in expired', 'That sign-in link has expired. Please try again.', true);
  }

  try {
    // Swap the code for a token, then ask Discord who this is
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.appId(), client_secret: process.env.DISCORD_CLIENT_SECRET!.trim(), grant_type: 'authorization_code', code, redirect_uri: redirectUri() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error(`Discord didn’t accept the sign-in (${tokenRes.status})`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
    if (!meRes.ok) throw new Error(`Discord didn’t say who you are (${meRes.status})`);
    const user = (await meRes.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };

    // Only members of the guild's Discord server get in
    const guildId = env.guildId();
    const m = await membership(user.id, guildId);
    const who = { discord_id: user.id, username: user.username, guild_id: guildId, guild_name: m.guildName };
    if (!m.member) {
      await recordSignIn({ kind: 'discord', result: 'not_member', ...who, detail: null });
      await auditTask(`<@${user.id}> (${user.username}) tried to sign in to the site but isn’t in the server`);
      return page('Not in the guild’s Discord', 'Guild Logs is for members of the guild’s Discord server. Join the server, then sign in again.', true);
    }
    // Access turned off on the Admin page
    const stored = await storedPerson(user.id);
    if (stored?.blocked) {
      await recordSignIn({ kind: 'discord', result: 'error', ...who, detail: 'access turned off' });
      return page('Access turned off', 'An officer has turned off your access to Guild Logs. Ask them if you think that\u2019s a mistake.', true);
    }
    const rank = effectiveRank(user.id, stored?.rank, discordRank(m));
    const officer = level(rank) >= level('officer');
    const name = m.nick || user.global_name || user.username;
    await recordSignIn({ kind: 'discord', result: 'ok', ...who, detail: rank === 'raider' ? null : RANK_LABEL[rank], name, avatar: user.avatar ?? null, officer, discordRank: discordRank(m) });
    await auditTask(`<@${user.id}> (${user.username}) signed in to the site (${RANK_LABEL[rank]})`);
    const cookie = await sessionCookie(secret, { kind: 'discord', uid: user.id, name, avatar: user.avatar ?? null, gid: guildId, officer });
    const headers = new Headers({ Location: safeNext(next) });
    headers.append('Set-Cookie', cookie);
    headers.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/login; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 303, headers });
  } catch (e) {
    console.error('discord sign-in failed', e);
    await recordSignIn({ kind: 'discord', result: 'error', discord_id: null, username: null, guild_id: env.guildId() || null, guild_name: null, detail: (e as Error).message.slice(0, 200) });
    return page('Sign-in didn’t work', `${(e as Error).message}. Please try again in a minute.`, true);
  }
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const expected = process.env.APP_PASSWORD;
  if (!secret || !expected) return new Response('Password sign-in is turned off. Sign in with Discord instead.', { status: 403 });

  const form = await req.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');
  const next = safeNext(String(form?.get('next') ?? '/'));
  if (!password || !(await passwordMatches(password, expected, secret))) {
    await recordSignIn({ kind: 'password', result: 'wrong_password', discord_id: null, username: null, guild_id: env.guildId() || null, guild_name: null, detail: null });
    return new Response(null, { status: 303, headers: { Location: `${next}${next.includes('?') ? '&' : '?'}error=1` } });
  }
  await recordSignIn({ kind: 'password', result: 'ok', discord_id: null, username: null, guild_id: env.guildId() || null, guild_name: null, detail: null });
  return new Response(null, { status: 303, headers: { Location: next, 'Set-Cookie': await sessionCookie(secret, { kind: 'password', officer: false }) } });
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A small message page in the site's colors. */
function page(title: string, message: string, retry = false): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guild Logs</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#302b27;color:#f5f3f5;font:15px/1.5 system-ui,sans-serif;padding:16px}
main{background:#1d1a17;border-radius:18px;padding:28px;max-width:380px;width:100%;box-sizing:border-box}h1{font-size:18px;margin:0 0 8px}p{color:rgba(245,243,245,.7);margin:0 0 18px}
a{display:inline-block;padding:10px 18px;border-radius:50px;background:#007cad;color:#fff;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${retry ? '<a href="/">Back to sign-in</a>' : ''}</main></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}
