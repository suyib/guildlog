// A game-style tooltip for a player: hover or focus the name (or the row it's in) to see their
// class and spec, then a few numbers. Pure CSS: shown with :hover and :focus-within.
import { GameIcon, classCss } from './icons';

const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

export interface TipLine { label: string; value: string; cls?: string }

/** The tooltip box itself. Put it inside an element with the "ptip" class. */
export function PlayerTipBox({ name, className, specName, role, lines, spells, spellsLabel = 'Top spells', note }: {
  name: string; className: string; specName?: string | null; role?: string | null; lines: TipLine[];
  /** Their top spells with their share of the total, shown under the numbers. */
  spells?: { name: string; pct: number; icon?: string }[];
  spellsLabel?: string;
  note?: string;
}) {
  const roleText = role === 'tank' ? 'Tank' : role === 'healer' ? 'Healer' : role === 'dps' ? 'Damage' : null;
  return (
    <span className="ptip-box" role="tooltip">
      <span className={`ptip-name ${classCss(className)}`}>{name}</span>
      <span className="ptip-line">{[specName ? spaced(specName) : null, className].filter(Boolean).join(' ')}</span>
      {roleText && <span className="ptip-grey">{roleText}</span>}
      {lines.length > 0 && <span className="ptip-rule" aria-hidden="true" />}
      {lines.map((l) => (
        <span key={l.label} className="ptip-row"><span className="ptip-label">{l.label}</span><span className={l.cls ?? 'ptip-value'}>{l.value}</span></span>
      ))}
      {spells && spells.length > 0 && (
        <>
          <span className="ptip-rule" aria-hidden="true" />
          <span className="ptip-grey">{spellsLabel}</span>
          {spells.map((x) => (
            <span key={x.name} className="ptip-spell">
              {x.icon ? <GameIcon file={x.icon} size={16} /> : <span className="ptip-spell-blank" aria-hidden="true" />}
              <span className="ptip-spell-name">{x.name}</span>
              <span className="ptip-spell-pct">{x.pct.toFixed(1)}%</span>
              <progress className="ptip-spell-bar" max={100} value={x.pct} aria-hidden="true" />
            </span>
          ))}
        </>
      )}
      {note && <><span className="ptip-rule" aria-hidden="true" /><span className="ptip-note">{note}</span></>}
    </span>
  );
}

/** A name with its tooltip, focusable for keyboards. */
export default function PlayerTip(props: Parameters<typeof PlayerTipBox>[0] & { children: React.ReactNode }) {
  const { children, ...tip } = props;
  return (
    <span className="ptip" tabIndex={0}>
      {children}
      <PlayerTipBox {...tip} />
    </span>
  );
}
