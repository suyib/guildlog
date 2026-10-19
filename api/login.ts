import { createSessionCookie, passwordMatches } from '../server/auth.js';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const expected = process.env.APP_PASSWORD;
  if (!secret || !expected) return new Response('Server is missing APP_PASSWORD or SESSION_SECRET', { status: 500 });

  const form = await req.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');
  // Only allow same-site paths like /a/<id> so the login can't be used to redirect elsewhere.
  const rawNext = String(form?.get('next') ?? '/');
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\') ? rawNext : '/';
  if (!password || !(await passwordMatches(password, expected, secret))) {
    return new Response(null, { status: 303, headers: { Location: `${next}${next.includes('?') ? '&' : '?'}error=1` } });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: next, 'Set-Cookie': await createSessionCookie(secret) },
  });
}
