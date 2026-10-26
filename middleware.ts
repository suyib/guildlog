// Vercel Routing Middleware: the whole site needs signing in (with Discord, or the guild password).
// Self-contained on purpose (no local imports) so it bundles cleanly for the middleware runtime.
// Unauthenticated page requests get a login form; API requests get 401.

export const config = {
  matcher: ['/((?!api/login|favicon.ico|logo.png).*)'],
};

// Open without signing in: the Terms and Privacy pages (Discord links to them), shared analysis
// links, the built app files those pages need, and the bot endpoints below. The app bundle holds no secrets; every API route stays protected.
// Discord and the reminder scheduler can't enter a password, so these endpoints check their own
// credentials instead (Discord's request signature, or the CRON_SECRET key).
const BOT_ENDPOINTS = ['/api/discord'];
// Shared analysis links (/a/<id>) open for anyone with the link, read-only: the page, and that one
// analysis from /api/history?id=<id>. Analyses use random IDs, so they can't be guessed or listed.
const ANALYSIS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPublic = (path: string, params: URLSearchParams) =>
  path === '/terms' || path === '/privacy' || path.startsWith('/assets/') || BOT_ENDPOINTS.includes(path) ||
  /^\/a\/[0-9a-f-]{36}\/?$/i.test(path) || (path === '/api/history' && ANALYSIS_ID.test(params.get('id') ?? ''));

const COOKIE_NAME = 'gl_session';

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** The cookie's value if its signature is right. */
async function unsign(secret: string, signed: string): Promise<string | null> {
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  const expected = await hmacHex(secret, value);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let j = 0; j < sig.length; j++) diff |= sig.charCodeAt(j) ^ expected.charCodeAt(j);
  return diff === 0 ? value : null;
}

/** Signed in: a Discord session for this server, or the guild password (older cookies too). */
async function hasValidSession(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const raw = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!raw) return false;
  const value = await unsign(secret, raw);
  if (!value) return false;
  const now = Date.now() / 1000;
  if (value.startsWith('v2:')) {
    try {
      const b64 = value.slice(3).replace(/-/g, '+').replace(/_/g, '/');
      const s = JSON.parse(decodeURIComponent(escape(atob(b64)))) as { kind: string; gid?: string; exp: number };
      const guild = process.env.DISCORD_GUILD_ID?.trim();
      return s.exp > now && (s.kind !== 'discord' || !guild || s.gid === guild);
    } catch {
      return false;
    }
  }
  return Number(value) > now; // older "<expiry>.<signature>" password cookie
}

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const loginPage = (error: boolean, next: string, discord: boolean, password: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guild Logs</title>
<style>
:root{--bg:#302b27;--panel:#1d1a17;--ink:#f5f3f5;--muted:rgba(245,243,245,.62);--line:rgba(245,243,245,.1);--primary:#007cad;--discord:#5865f2}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:16px}
main{background:var(--panel);border-radius:18px;padding:28px;width:100%;max-width:360px;box-sizing:border-box}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 6px}.brand img{width:36px;height:36px}
h1{font-size:20px;margin:0}h1 span{color:#62bee3}p{color:var(--muted);margin:0 0 20px;font-size:13px}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;height:44px;border:0;border-radius:50px;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none;color:#fff}
.discord{background:var(--discord)}.discord:hover{background:#4752c4}
.or{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;margin:18px 0}.or::before,.or::after{content:'';flex:1;border-top:1px solid var(--line)}
input{width:100%;box-sizing:border-box;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:#302b27;color:var(--ink);font-size:15px}
.pw{margin-top:10px;background:var(--primary)}
.err{color:#ff6b6b;font-size:13px;margin-top:10px}
.legal{margin-top:18px;font-size:12px;color:var(--muted);text-align:center}.legal a{color:var(--muted)}
</style></head><body><main>
<div class="brand"><img src="/logo.png" alt=""><h1>Guild <span>Logs</span></h1></div>
<p>${discord ? 'Sign in with the Discord account you use in the guild\u2019s server.' : 'Enter the guild password to continue.'}</p>
${discord ? `<a class="btn discord" href="/api/login?discord=1&amp;next=${encodeURIComponent(next)}"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.6 5.3A17 17 0 0 0 15.4 4l-.5 1.1a15.8 15.8 0 0 0-5.8 0L8.6 4a17 17 0 0 0-4.2 1.3C1.7 9.3 1 13.2 1.3 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-3.1-11.7zM8.7 14.7c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9.9 1.9 2.1-.8 2.1-1.9 2.1zm6.6 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9.9 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>Sign in with Discord</a>` : ''}
${discord && password ? '<div class="or">or</div>' : ''}
${password ? `<form method="post" action="/api/login">
<input type="hidden" name="next" value="${escapeAttr(next)}">
<input type="password" name="password" ${discord ? '' : 'autofocus'} required aria-label="Guild password" placeholder="Guild password">
<button class="btn pw" type="submit">Enter</button>
${error ? '<div class="err">Wrong password, try again.</div>' : ''}
</form>` : ''}
<div class="legal"><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a></div>
</main></body></html>`;

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (isPublic(url.pathname, url.searchParams)) return new Response(null, { headers: { 'x-middleware-next': '1' } });
  let ok = false;
  try {
    ok = await hasValidSession(request, process.env.SESSION_SECRET);
  } catch {
    ok = false;
  }
  if (ok) return new Response(null, { headers: { 'x-middleware-next': '1' } });

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const next = url.pathname + url.search.replace(/[?&]error=1/, '').replace(/^&/, '?');
  const discord = !!(process.env.DISCORD_CLIENT_SECRET?.trim() && process.env.DISCORD_APP_ID?.trim() && process.env.DISCORD_GUILD_ID?.trim());
  const password = !!process.env.APP_PASSWORD?.trim() || !discord;
  return new Response(loginPage(url.searchParams.has('error'), next, discord, password), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
