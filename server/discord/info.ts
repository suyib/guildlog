// GAME CONTENT (Burning Crusade for now; replace with WoW Forever's items once they're known).
// /info content. Edit freely: this is plain data, shown as-is in Discord.
// Links go to Wowhead searches; the bot doesn't copy Wowhead's pages (their terms don't allow scraping).
import { BRAND, type MessageBody, linkButton, row } from './api.js';

const WOWHEAD = (process.env.WOWHEAD_BASE?.trim() || 'https://www.wowhead.com/tbc').replace(/\/$/, '');
const search = (q: string) => `${WOWHEAD}/search?q=${encodeURIComponent(q)}`;

export type Role = 'physical' | 'caster' | 'healer' | 'tank';

interface Kit { flask: string[]; elixirs: string[]; food: string[]; potions: string[]; weapon: string[]; other: string[] }

/** Burning Crusade raid consumables (Fresh). Update when WoW Forever's items are known. */
const CONSUMABLES: Record<Role, { label: string; kit: Kit }> = {
  physical: {
    label: 'Physical DPS (melee and hunters)',
    kit: {
      flask: ['Flask of Relentless Assault'],
      elixirs: ['Elixir of Major Agility or Onslaught Elixir (battle)', 'Elixir of Major Fortitude (guardian)'],
      food: ['Grilled Mudfish or Warp Burger (Agility)', 'Roasted Clefthoof (Strength)', 'Ravager Dog (attack power)', 'Spicy Hot Talbuk (hit)'],
      potions: ['Haste Potion', 'Super Mana Potion (hunters)'],
      weapon: ['Adamantite Sharpening Stone or Adamantite Weightstone (melee)'],
      other: ['Scroll of Agility V / Scroll of Strength V', 'Drums of Battle (leatherworkers)'],
    },
  },
  caster: {
    label: 'Caster DPS',
    kit: {
      flask: ['Flask of Pure Death (shadow, fire, frost)', 'Flask of Blinding Light (arcane, holy, nature)'],
      elixirs: ["Adept's Elixir or your school's Major elixir (battle)", 'Elixir of Draenic Wisdom (guardian)'],
      food: ['Blackened Basilisk or Crunchy Serpent (spell damage)'],
      potions: ['Destruction Potion', 'Super Mana Potion'],
      weapon: ['Superior Wizard Oil'],
      other: ['Flame Cap (fire)', 'Dark Rune / Demonic Rune (mana)'],
    },
  },
  healer: {
    label: 'Healers',
    kit: {
      flask: ['Flask of Mighty Restoration'],
      elixirs: ['Elixir of Healing Power (battle)', 'Elixir of Major Mageblood or Elixir of Draenic Wisdom (guardian)'],
      food: ['Golden Fish Sticks (healing)', 'Blackened Sporefish (mana regen)'],
      potions: ['Super Mana Potion'],
      weapon: ['Superior Mana Oil'],
      other: ['Dark Rune / Demonic Rune (mana)'],
    },
  },
  tank: {
    label: 'Tanks',
    kit: {
      flask: ['Flask of Fortification'],
      elixirs: ['Elixir of Major Defense or Elixir of Major Fortitude (guardian)', 'Elixir of Major Agility or Elixir of Major Strength (battle, for threat)'],
      food: ['Fisherman’s Feast or Spicy Crawdad (Stamina)'],
      potions: ['Ironshield Potion', 'Super Healing Potion'],
      weapon: ['Adamantite Sharpening Stone or Adamantite Weightstone'],
      other: ['Scroll of Protection V'],
    },
  },
};

export const ROLE_CHOICES = (Object.keys(CONSUMABLES) as Role[]).map((r) => ({ name: CONSUMABLES[r].label, value: r }));

const list = (items: string[]) => items.map((i) => `• ${i}`).join('\n');

export function consumablesMessage(role: Role): MessageBody {
  const { label, kit } = CONSUMABLES[role];
  return {
    embeds: [
      {
        title: `Raid consumables: ${label}`,
        color: BRAND,
        description: 'A flask, or one battle elixir plus one guardian elixir, then food, potions and a weapon buff.',
        fields: [
          { name: 'Flask', value: list(kit.flask) },
          { name: 'Elixirs (instead of a flask)', value: list(kit.elixirs) },
          { name: 'Food', value: list(kit.food) },
          { name: 'Potions', value: list(kit.potions) },
          { name: 'Weapon', value: list(kit.weapon) },
          { name: 'Also useful', value: list(kit.other) },
        ],
        footer: { text: 'Burning Crusade items. Check your class guide for spec-specific picks.' },
      },
    ],
    components: [row(linkButton('Search Wowhead', search(kit.flask[0].replace(/\s*\(.*\)$/, ''))))],
  };
}

/** /info lookup: links straight to Wowhead's search for anything else (items, spells, quests). */
export function lookupMessage(query: string): MessageBody {
  return {
    content: `Wowhead results for **${query}**:`,
    components: [row(linkButton(`Search "${query.slice(0, 60)}"`, search(query)))],
  };
}

export const RAID_CHECKLIST = ['Flask or elixirs', 'Food buff', 'Potions', 'Weapon oil or stone', 'Repaired gear', 'Reagents and ammo'];
