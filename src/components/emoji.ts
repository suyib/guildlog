const CLASS_EMOJI: Record<string, string> = {
  Hunter: '🏹',
  Paladin: '🔨',
  Warrior: '⚔️',
  Rogue: '🗡️',
  Mage: '🔥',
  Warlock: '😈',
  Priest: '✝️',
  Druid: '🐻',
  Shaman: '⚡',
};

export const classEmoji = (className: string) => CLASS_EMOJI[className] ?? '🧙';

/** CSS class that colours a name in its WoW class colour (see styles.css). */
export const classCss = (className: string) => `cls-${(className || 'unknown').toLowerCase()}`;

/** Warcraft Logs-style parse colour bands. */
export function parseCss(p: number | null | undefined): string {
  if (p === null || p === undefined) return 'parse-none';
  if (p >= 100) return 'parse-gold';
  if (p >= 99) return 'parse-pink';
  if (p >= 95) return 'parse-orange';
  if (p >= 75) return 'parse-purple';
  if (p >= 50) return 'parse-blue';
  if (p >= 25) return 'parse-green';
  return 'parse-grey';
}

export const SEVERITY_EMOJI = { high: '🔴', medium: '🟠', low: '⚪' } as const;

/** Human label for a saved comparison choice. */
export function compareLabel(key: string | undefined): string {
  if (!key || key === 'auto') return '✨ Auto';
  if (key === 'top') return '🏆 Top parse';
  if (key === 'previous') return '🕰️ Previous kill';
  if (key.startsWith('p:')) return `vs ${key.slice(2)}`;
  return key;
}
