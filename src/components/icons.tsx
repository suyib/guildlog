import { useState } from 'react';
// Game icons. Warcraft Logs gives each ability and buff an icon file name (e.g. ability_hunter_steadyshot.jpg);
// the images themselves come from Wowhead's public icon CDN, which uses the same names.

const ICON_CDN = 'https://wow.zamimg.com/images/wow/icons';

const CLASS_ICON: Record<string, string> = {
  Hunter: 'classicon_hunter',
  Paladin: 'classicon_paladin',
  Warrior: 'classicon_warrior',
  Rogue: 'classicon_rogue',
  Mage: 'classicon_mage',
  Warlock: 'classicon_warlock',
  Priest: 'classicon_priest',
  Druid: 'classicon_druid',
  Shaman: 'classicon_shaman',
};

const iconName = (file?: string | null) => (file ? file.replace(/\.(jpg|png|gif)$/i, '').toLowerCase() : '');

export function GameIcon({ file, size = 18, alt = '' }: { file?: string | null; size?: number; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const name = iconName(file);
  // An empty frame when there's no icon, or the image doesn't load
  if (failed || !name || name === 'pet' || !/^[a-z0-9_-]+$/.test(name)) return <BlankIcon size={size} />;
  return (
    <img
      className="icon"
      src={`${ICON_CDN}/${size > 36 ? 'large' : 'medium'}/${name}.jpg`}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Empty icon frame, sized with attributes so it needs no inline style. */
export function BlankIcon({ size = 18 }: { size?: number }) {
  return <svg className="icon icon-blank" width={size} height={size} aria-hidden="true" />;
}

/** Each spec's icon, by class and spec as Warcraft Logs names them. GAME CONTENT (Classic-era icons). */
const SPEC_ICON: Record<string, string> = {
  'hunter-beastmastery': 'ability_hunter_beasttaming', 'hunter-marksmanship': 'ability_marksmanship', 'hunter-survival': 'ability_hunter_swiftstrike',
  'mage-arcane': 'spell_holy_magicalsentry', 'mage-fire': 'spell_fire_firebolt02', 'mage-frost': 'spell_frost_frostbolt02',
  'warlock-affliction': 'spell_shadow_deathcoil', 'warlock-demonology': 'spell_shadow_metamorphosis', 'warlock-destruction': 'spell_shadow_rainoffire',
  'priest-discipline': 'spell_holy_wordfortitude', 'priest-holy': 'spell_holy_guardianspirit', 'priest-shadow': 'spell_shadow_shadowwordpain',
  'warrior-arms': 'ability_warrior_savageblow', 'warrior-fury': 'ability_warrior_innerrage', 'warrior-protection': 'ability_warrior_defensivestance',
  'rogue-assassination': 'ability_rogue_eviscerate', 'rogue-combat': 'ability_backstab', 'rogue-subtlety': 'ability_stealth',
  'druid-balance': 'spell_nature_starfall', 'druid-feral': 'ability_racial_bearform', 'druid-guardian': 'ability_racial_bearform', 'druid-restoration': 'spell_nature_healingtouch',
  'shaman-elemental': 'spell_nature_lightning', 'shaman-enhancement': 'spell_nature_lightningshield', 'shaman-restoration': 'spell_nature_magicimmunity',
  'paladin-holy': 'spell_holy_holybolt', 'paladin-protection': 'spell_holy_devotionaura', 'paladin-retribution': 'spell_holy_auraoflight',
};
const specKey = (className: string, spec?: string | null) => `${className}-${spec ?? ''}`.toLowerCase().replace(/\s+/g, '');

/** A class's icon, or its spec's when the spec is known (Frost rather than just Mage). */
export function ClassIcon({ className, spec, size = 18 }: { className: string; spec?: string | null; size?: number }) {
  const file = (spec && SPEC_ICON[specKey(className, spec)]) || CLASS_ICON[className] || 'inv_misc_questionmark';
  return <GameIcon file={file} size={size} alt={spec ? `${spec.replace(/([a-z])([A-Z])/g, '$1 $2')} ${className}` : className} />;
}

/** Tank, healer or damage, as a small round game icon. GAME CONTENT */
const ROLE_ICON = { tank: 'inv_shield_06', healer: 'spell_holy_flashheal', dps: 'inv_sword_04' } as const;
export function RoleIcon({ role, size = 14 }: { role: 'tank' | 'healer' | 'dps' | null | undefined; size?: number }) {
  if (!role) return null;
  return <span className="role-icon" title={role === 'tank' ? 'Tank' : role === 'healer' ? 'Healer' : 'Damage'}><GameIcon file={ROLE_ICON[role]} size={size} alt={role} /></span>;
}

/** The game icon for a number tile, by the line icon it used to have. GAME CONTENT */
const TILE_ICON: Record<string, string> = {
  calendar: 'inv_misc_book_09', check: 'achievement_dungeon_gloryoftheraider', timer: 'inv_misc_pocketwatch_01', users: 'inv_misc_groupneedmore',
  alert: 'spell_holy_resurrection', shield: 'inv_shield_06', bolt: 'spell_nature_lightning', pulse: 'spell_holy_flashheal', target: 'ability_hunter_steadyshot',
  bars: 'inv_misc_note_01', clock: 'inv_misc_pocketwatch_01',
};
/** A number tile's picture: a game icon. */
export function TileIcon({ glyph }: { glyph: string }) {
  return <span className="tile-icon"><GameIcon file={TILE_ICON[glyph] ?? 'inv_misc_questionmark'} size={36} /></span>;
}

/** A "nothing here yet" note with a large, faded game icon. */
export function EmptyNote({ icon = 'inv_misc_map_01', children }: { icon?: string; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <GameIcon file={icon} size={56} />
      <p className="muted empty-note">{children}</p>
    </div>
  );
}

/** CSS class that colors a name in its WoW class color (see theme.css). */
export const classCss = (className: string) => `cls-${(className || 'unknown').toLowerCase()}`;

/** Warcraft Logs-style parse color bands. */
export function parseCss(p: number | null | undefined): string {
  if (p === null || p === undefined) return 'parse-none';
  if (p >= 100) return 'parse-gold';
  if (p >= 99) return 'parse-pink';
  if (p >= 95) return 'parse-orange';
  if (p >= 75) return 'parse-purple';
  if (p >= 50) return 'parse-blue';
  if (p >= 25) return 'parse-green';
  return 'parse-gray';
}

/** Small colored dot showing a finding's priority. */
export function SeverityDot({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const label = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' }[severity];
  return <span className={`dot dot-${severity}`} role="img" aria-label={label} title={label} />;
}

/** Human label for a saved comparison choice. */
export function compareLabel(key: string | undefined): string {
  if (!key || key === 'none') return 'Nothing (just my stats)';
  if (key.startsWith('p:')) return `vs ${key.slice(2)}`;
  if (key.startsWith('l:')) return `vs ${key.split(':').slice(4).join(':')} (other log)`;
  return key;
}

/**
 * A boss's picture from Warcraft Logs (by encounter); a plain circle if there isn't one. Classic logs
 * can use a prefixed ID (51604 for 1604) that has no picture of its own, so that falls back to the
 * plain ID. GAME CONTENT
 */
export function BossIcon({ id, size = 'normal' }: { id: number; size?: 'small' | 'normal' | 'big' }) {
  const ids = [...new Set([Math.trunc(id), Math.trunc(id) % 10000])];
  const [tried, setTried] = useState(0);
  const cls = size === 'normal' ? 'boss-icon' : `boss-icon ${size}`;
  const px = size === 'small' ? 22 : size === 'big' ? 48 : 32;
  if (tried >= ids.length) return <span className={cls} aria-hidden="true" />;
  return <img key={ids[tried]} className={cls} src={`https://assets.rpglogs.com/img/warcraft/bosses/${ids[tried]}-icon.jpg`} width={px} height={px} alt="" loading="lazy" onError={() => setTried((t) => t + 1)} />;
}
