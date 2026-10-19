// Shared-password session cookie, signed with HMAC-SHA256.
// Uses Web Crypto so it runs in both Vercel Edge middleware and Node functions.

export const COOKIE_NAME = 'gl_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

export async function passwordMatches(input: string, expected: string, secret: string): Promise<boolean> {
  // Compare HMACs so the comparison is constant-length.
  const [a, b] = await Promise.all([hmac(secret, input), hmac(secret, expected)]);
  return safeEqual(a, b);
}

export async function createSessionCookie(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const sig = await hmac(secret, String(exp));
  return `${COOKIE_NAME}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export async function isValidSession(cookieHeader: string | null, secret: string): Promise<boolean> {
  const value = readCookie(cookieHeader, COOKIE_NAME);
  if (!value) return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(secret, expStr));
}

export async function requireSession(req: Request): Promise<Response | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return json({ error: 'Server is missing SESSION_SECRET' }, 500);
  if (!(await isValidSession(req.headers.get('cookie'), secret))) return json({ error: 'Not signed in' }, 401);
  return null;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
