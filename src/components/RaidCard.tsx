// A raid as a card with its art behind it, like a loading screen: the raid size, its name and a
// line under it. The art is public/zones/<raid-name>.jpg when you add one (e.g. barrow-deeps.jpg),
// otherwise Warcraft Logs' small zone picture blurred to fill, otherwise a plain dark card.
import { useState } from 'react';
import { raidSize } from '../../server/game';

/** "Onyxia's Lair" → "onyxias-lair", the file name for your own art in public/zones. */
export const raidSlug = (name: string) => name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function RaidArt({ id, name }: { id: number | null | undefined; name: string }) {
  const srcs = [`/zones/${raidSlug(name)}.jpg`, id ? `https://assets.rpglogs.com/img/warcraft/zones/zone-${Math.trunc(id)}.png` : null].filter((s): s is string => !!s);
  const [tried, setTried] = useState(0);
  if (tried >= srcs.length) return null;
  // Warcraft Logs' picture is small, so it's blurred into a backdrop rather than shown sharp
  return <img key={srcs[tried]} className={`zone-art${tried > 0 ? ' blurred' : ''}`} src={srcs[tried]} alt="" loading="lazy" onError={() => setTried((t) => t + 1)} />;
}

/**
 * What goes inside a raid card. The caller gives the outer element the "zone-card" class (a
 * summary, a header or a div), so the card can open an accordion or head a page.
 */
export function RaidCardBody({ id, name, title, sub, details, heading = 'strong', children }: {
  id: number | null | undefined;
  /** The raid (zone) name, which picks the art and size. */
  name: string;
  /** What the card says, when not the raid name (e.g. a report's title). */
  title?: string;
  sub?: React.ReactNode;
  /** More lines under the name (boss portraits, last visit…). */
  details?: React.ReactNode;
  heading?: 'strong' | 'h1' | 'h2';
  children?: React.ReactNode;
}) {
  const size = raidSize(name);
  const Title = heading;
  return (
    <>
      <RaidArt id={id} name={name} />
      {size && <span className="zone-size" title={`${size}-player raid`}>{size}</span>}
      <span className="zone-card-text">
        <Title className="zone-card-name">{title ?? name}</Title>
        {sub && <span className="zone-card-sub">{sub}</span>}
        {details}
      </span>
      {children}
    </>
  );
}
