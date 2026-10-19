// Which analysis is on screen and which of its sections is showing, shared by the sidebar and the result view.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AnalysisResult } from '../server/types';

export type SectionId = 'overview' | 'rotation' | 'damage' | 'gear' | 'buffs' | 'compare';

export const SECTIONS: { id: SectionId; label: string; glyph: GlyphName }[] = [
  { id: 'overview', label: 'Overview', glyph: 'grid' },
  { id: 'rotation', label: 'Rotation & cooldowns', glyph: 'cycle' },
  { id: 'damage', label: 'Damage breakdown', glyph: 'bars' },
  { id: 'gear', label: 'Gear & stats', glyph: 'shield' },
  { id: 'buffs', label: 'Buffs & survival', glyph: 'pulse' },
  { id: 'compare', label: 'Side by side', glyph: 'users' },
];

export type GlyphName =
  | 'compass' | 'clock' | 'grid' | 'cycle' | 'bars' | 'shield' | 'pulse' | 'users'
  | 'bolt' | 'target' | 'timer' | 'link' | 'copy' | 'up' | 'down' | 'search' | 'check' | 'alert';

/** Sections that have something to show for this result. */
export function sectionsFor(result: AnalysisResult | null) {
  if (!result) return [];
  return SECTIONS.filter((s) => s.id !== 'compare' || result.comparisons.length > 0);
}

interface Nav {
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
  section: SectionId;
  setSection: (s: SectionId) => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [section, setSection] = useState<SectionId>('overview');
  // A new analysis always opens on its overview
  useEffect(() => setSection('overview'), [result?.id, result?.player.name, result?.player.fightId, result?.compareKey]);
  return <NavContext.Provider value={{ result, setResult, section, setSection }}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const v = useContext(NavContext);
  if (!v) throw new Error('useNav must be used inside NavProvider');
  return v;
}
