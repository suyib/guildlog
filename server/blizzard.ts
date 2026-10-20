// Character portraits from the Blizzard profile API (optional).
// Needs BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET from https://develop.battle.net/access/clients.
// Classic-family realms use different profile namespaces; we try each until one answers.
// Set BLIZZARD_PROFILE_NAMESPACES (comma-separated) once you know which one WoW Forever uses.

const DEFAULT_NAMESPACES = ['profile-classicann', 'profile-classic1x', 'profile-classic'];
let token: { value: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export const realmSlug = (realm: string) =>
  realm
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const portraitsEnabled = () => !!(process.env.BLIZZARD_CLIENT_ID && process.env.BLIZZARD_CLIENT_SECRET);

/** Returns the character's avatar image URL, or null if it can't be found. */
export async function characterPortrait(region: string, realm: string, name: string): Promise<string | null> {
  const t = await getToken();
  if (!t || !/^(us|eu|kr|tw)$/.test(region)) return null;
  const configured = (process.env.BLIZZARD_PROFILE_NAMESPACES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const namespaces = configured.length ? configured : DEFAULT_NAMESPACES;
  const charSlug = encodeURIComponent(name.toLowerCase());
  for (const ns of namespaces) {
    try {
      const url = `https://${region}.api.blizzard.com/profile/wow/character/${realmSlug(realm)}/${charSlug}/character-media?namespace=${ns}-${region}&locale=en_US`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { assets?: { key: string; value: string }[]; avatar_url?: string };
      const asset = body.assets?.find((a) => a.key === 'avatar') ?? body.assets?.find((a) => a.key === 'inset');
      if (asset?.value) return asset.value;
      if (body.avatar_url) return body.avatar_url;
    } catch {
      /* try the next namespace */
    }
  }
  return null;
}

/** Character level from the Blizzard profile API, or null if it can't be found. */
export async function characterLevel(region: string, realm: string, name: string): Promise<number | null> {
  const t = await getToken();
  if (!t || !/^(us|eu|kr|tw)$/.test(region)) return null;
  const configured = (process.env.BLIZZARD_PROFILE_NAMESPACES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const ns of configured.length ? configured : DEFAULT_NAMESPACES) {
    try {
      const url = `https://${region}.api.blizzard.com/profile/wow/character/${realmSlug(realm)}/${encodeURIComponent(name.toLowerCase())}?namespace=${ns}-${region}&locale=en_US`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { level?: number };
      if (typeof body.level === 'number') return body.level;
    } catch {
      /* try the next namespace */
    }
  }
  return null;
}
