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
  | 'bolt' | 'target' | 'timer' | 'link' | 'copy' | 'up' | 'down' | 'search' | 'check' | 'alert' | 'calendar' | 'coffee';

/** Damage done or Healing done: which numbers the analysis shows. */
export type View = 'damage' | 'healing';

/** A healer for this fight: healing well above their damage. Their analysis opens on Healing done. */
export function isHealer(result: AnalysisResult | null): boolean {
  const h = result?.dashboard?.healing ?? result?.player.healing;
  return !!h && h.total > 2 * (result?.player.total ?? 0);
}

/** Sections that have something to show for this result (the damage section is about healing on the Healing tab). */
export function sectionsFor(result: AnalysisResult | null, view: View = 'damage') {
  if (!result) return [];
  return SECTIONS.filter((s) => s.id !== 'compare' || result.comparisons.length > 0).map((s) =>
    s.id === 'damage' && view === 'healing' ? { ...s, label: 'Healing breakdown' } : s,
  );
}

interface Nav {
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
  section: SectionId;
  setSection: (s: SectionId) => void;
  view: View;
  setView: (v: View) => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [section, setSection] = useState<SectionId>('overview');
  const [view, setView] = useState<View>('damage');
  // A new analysis always opens on its overview, on Healing done for healers
  useEffect(() => {
    setSection('overview');
    setView(isHealer(result) ? 'healing' : 'damage');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.id, result?.player.name, result?.player.fightId, result?.compareKey]);
  return <NavContext.Provider value={{ result, setResult, section, setSection, view, setView }}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const v = useContext(NavContext);
  if (!v) throw new Error('useNav must be used inside NavProvider');
  return v;
}
