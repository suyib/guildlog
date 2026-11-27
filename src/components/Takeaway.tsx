// "What this means" under a chart or table: a few lines worked out from the numbers, each with the
// icon of the spell it's about when there is one.
import type { Line } from '../takeaways';
import { GameIcon } from './icons';

export default function Takeaway({ lines }: { lines: Line[] }) {
  if (!lines.length) return null;
  return (
    <div className="takeaway">
      <span className="takeaway-label">What this means</span>
      {lines.map((l, i) => (
        <p key={i} className={l.icon ? 'with-spell' : ''}>{l.icon && <GameIcon file={l.icon} size={22} />}<span>{l.text}</span></p>
      ))}
    </div>
  );
}
