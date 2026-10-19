// Vercel Routing Middleware: gates the whole site behind one shared password.
// Self-contained on purpose (no local imports) so it bundles cleanly for the middleware runtime.
// Unauthenticated page requests get a login form; API requests get 401.

export const config = {
  matcher: ['/((?!api/login|favicon.ico).*)'],
};

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

async function hasValidSession(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const value = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!value) return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  const expected = await hmacHex(secret, expStr);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const loginPage = (error: boolean, next: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guild Logs</title>
<style>
:root{--bg:#0e0e10;--panel:#1b1b1f;--ink:#e8e6e1;--muted:#9a978f;--line:#2e2e34;--accent:#ff8000}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 'Open Sans',system-ui,sans-serif;padding:16px}
form{background:var(--panel);border:1px solid var(--line);border-top:2px solid var(--accent);border-radius:4px;padding:28px;width:100%;max-width:340px;box-sizing:border-box}
h1{font-size:18px;margin:0 0 4px;letter-spacing:.02em}p{color:var(--muted);margin:0 0 20px;font-size:13px}
input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line);border-radius:3px;background:#121215;color:var(--ink);font-size:15px}
button{margin-top:12px;width:100%;padding:9px;border:0;border-radius:3px;background:var(--accent);color:#111;font-weight:700;font-size:15px;cursor:pointer}
.err{color:#ff5c5c;font-size:13px;margin-top:10px}
</style></head><body>
<form method="post" action="/api/login">
<h1>⚔️ Guild Logs</h1><p>Enter the guild password to continue.</p>
<input type="hidden" name="next" value="${escapeAttr(next)}">
<input type="password" name="password" autofocus required aria-label="Password">
<button type="submit">Enter</button>
${error ? '<div class="err">Wrong password, try again.</div>' : ''}
</form></body></html>`;

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
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
  return new Response(loginPage(url.searchParams.has('error'), next), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
