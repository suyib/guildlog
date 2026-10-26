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

export function ClassIcon({ className, size = 18 }: { className: string; size?: number }) {
  return <GameIcon file={CLASS_ICON[className] ?? 'inv_misc_questionmark'} size={size} alt={className} />;
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

/** A boss's picture from Warcraft Logs (by encounter); a plain circle if there isn't one. GAME CONTENT */
export function BossIcon({ id, small = false }: { id: number; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = small ? 'boss-icon small' : 'boss-icon';
  const size = small ? 22 : 32;
  if (failed) return <span className={cls} aria-hidden="true" />;
  return <img className={cls} src={`https://assets.rpglogs.com/img/warcraft/bosses/${Math.trunc(id)}-icon.jpg`} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
