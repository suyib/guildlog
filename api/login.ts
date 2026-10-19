import { createSessionCookie, passwordMatches } from '../server/auth.js';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const expected = process.env.APP_PASSWORD;
  if (!secret || !expected) return new Response('Server is missing APP_PASSWORD or SESSION_SECRET', { status: 500 });

  const form = await req.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');
  if (!password || !(await passwordMatches(password, expected, secret))) {
    return new Response(null, { status: 303, headers: { Location: '/?error=1' } });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': await createSessionCookie(secret) },
  });
}
