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

export const SEVERITY_EMOJI = { high: '🔴', medium: '🟠', low: '⚪' } as const;
