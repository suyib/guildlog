// GAME CONTENT (Burning Crusade for now; replace with WoW Forever's buffs once they're known).
// Buffs that any class can have, so they're fair to compare across classes.
export const GENERAL_BUFF_HINTS = [
  'Bloodlust', 'Heroism', 'Power Infusion', 'Leader of the Pack', 'Unleashed Rage', 'Trueshot Aura', 'Battle Shout',
  'Blessing', 'Fortitude', 'Mark of the Wild', 'Gift of the Wild', 'Arcane Brilliance', 'Arcane Intellect', 'Spirit',
  'Well Fed', 'Elixir', 'Flask', 'Potion', 'Haste', 'Agility', 'Strength', 'Drums', 'Totem', 'Windfury', 'Ferocious Inspiration',
];
export const isGeneralBuff = (name: string) => GENERAL_BUFF_HINTS.some((h) => name.includes(h));
