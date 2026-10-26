// Sign-in sessions, in a cookie signed with HMAC-SHA256 (Web Crypto, so it also runs in the
// middleware). Two kinds:
//   Discord: who you are (Discord ID, name, avatar), which server (guild) you're signed in for,
//            and whether you're an officer there.
//   Password: the older shared guild password. Still accepted while APP_PASSWORD is set.
// The guild ID is part of every Discord session, so one site can later serve several guilds.

export const COOKIE_NAME = 'gl_session';
export const SESSION_DAYS = { discord: 7, password: 30 };

export interface Session {
  kind: 'discord' | 'password';
  /** Discord user ID (Discord sessions only). */
  uid?: string;
  name?: string;
  /** Discord avatar hash, for the picture in the menu. */
  avatar?: string | null;
  /** The Discord server this session is for. */
  gid?: string;
  /** Officer when signed in, rechecked live with Discord for officer-only actions. */
  officer: boolean;
  exp: number;
}

const enc = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export async function passwordMatches(input: string, expected: string, secret: string): Promise<boolean> {
  // Compare HMACs so the comparison is constant-length.
  const [a, b] = await Promise.all([hmac(secret, input), hmac(secret, expected)]);
  return safeEqual(a, b);
}

/** Sign a small value (used for the session and for Discord's sign-in "state"). */
export async function sign(secret: string, value: string): Promise<string> {
  return `${value}.${await hmac(secret, value)}`;
}

/** The value if its signature is right, else null. */
export async function unsign(secret: string, signed: string): Promise<string | null> {
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const value = signed.slice(0, i);
  return safeEqual(signed.slice(i + 1), await hmac(secret, value)) ? value : null;
}

export async function sessionCookie(secret: string, s: Omit<Session, 'exp'>): Promise<string> {
  const days = SESSION_DAYS[s.kind];
  const session: Session = { ...s, exp: Math.floor(Date.now() / 1000) + days * 86_400 };
  const value = await sign(secret, `v2:${b64url(JSON.stringify(session))}`);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86_400}`;
}

/** Kept for the password form: a password session. */
export const createSessionCookie = (secret: string) => sessionCookie(secret, { kind: 'password', officer: false });

export const clearSessionCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** The signed-in session from the request's cookie, or null. Older password cookies still count. */
export async function readSession(cookieHeader: string | null, secret: string): Promise<Session | null> {
  const raw = readCookie(cookieHeader, COOKIE_NAME);
  if (!raw) return null;
  const value = await unsign(secret, raw);
  if (!value) return null;
  const now = Date.now() / 1000;
  if (value.startsWith('v2:')) {
    try {
      const s = JSON.parse(unb64url(value.slice(3))) as Session;
      return s.exp > now ? s : null;
    } catch {
      return null;
    }
  }
  // Before v0.18.0 the cookie was just "<expiry>.<signature>" from the guild password
  const exp = Number(value);
  return exp > now ? { kind: 'password', officer: false, exp } : null;
}

/** A Discord session is for one server; it only opens the site of that server. */
export const forThisGuild = (s: Session) => s.kind !== 'discord' || !process.env.DISCORD_GUILD_ID?.trim() || s.gid === process.env.DISCORD_GUILD_ID.trim();

export async function isValidSession(cookieHeader: string | null, secret: string): Promise<boolean> {
  return (await readSession(cookieHeader, secret)) !== null;
}

/** For API routes: null when signed in, else the error response to send. */
export async function requireSession(req: Request): Promise<Response | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return json({ error: 'Server is missing SESSION_SECRET' }, 500);
  const session = await readSession(req.headers.get('cookie'), secret);
  if (!session || !forThisGuild(session)) return json({ error: 'Not signed in' }, 401);
  // Turned off on the Admin page: refused straight away, not only at the next sign-in
  if (session.kind === 'discord' && session.uid) {
    const { isBlocked } = await import('./ranks.js');
    if (await isBlocked(session.uid)) return json({ error: 'Your access to Guild Logs has been turned off by an officer.' }, 403);
    // Left the guild's Discord since signing in: refused too (checked every 10 minutes)
    if (!(await stillMember(session.uid, session.gid))) return json({ error: 'You\u2019re no longer in the guild\u2019s Discord server.', notMember: true }, 403);
  }
  return null;
}

const memberCache = new Map<string, { member: boolean; at: number }>();

/**
 * Still in the guild's Discord server. Only a clear "not a member" answer from Discord counts:
 * if Discord can't be reached, people already signed in carry on.
 */
export async function stillMember(uid: string, gid?: string): Promise<boolean> {
  const { discord, env } = await import('./discord/api.js');
  const guild = gid || env.guildId();
  if (!guild || !process.env.DISCORD_BOT_TOKEN) return true;
  const hit = memberCache.get(uid);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.member;
  let member = true;
  try {
    await discord(`/guilds/${guild}/members/${uid}`);
  } catch (e) {
    member = !/Discord 404|Unknown Member/i.test((e as Error).message);
  }
  memberCache.set(uid, { member, at: Date.now() });
  return member;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
