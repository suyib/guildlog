// The bot's Discord messages on the site: the same embeds, laid out as panels. A small reader for
// the markdown Discord uses (**bold**, _italic_, `code`, [links](…), "> " quotes and "• " bullets).
import type { SiteEmbed } from '../../server/types';

/** One line of Discord markdown as React. */
export function Md({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w])_[^_]+_(?![\w]))/g).filter((x) => x !== '');
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) return <a key={i} href={link[2]} target={link[2].startsWith('http') && !link[2].includes(window.location.host) ? '_blank' : undefined} rel="noreferrer">{link[1]}</a>;
        if (p.length > 2 && p.startsWith('_') && p.endsWith('_')) return <em key={i}>{p.slice(1, -1)}</em>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** A block of Discord text: bullets become a list, "> " lines a quote, the rest paragraphs. */
export function MdBlock({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`l${out.length}`} className="md-list">{list.map((l, i) => <li key={i}><Md text={l} /></li>)}</ul>);
    list = [];
  };
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('•') || t.startsWith('- ')) list.push(t.replace(/^(•|-)\s*/, ''));
    else {
      flush();
      if (t.startsWith('>')) out.push(<p key={`q${out.length}`} className="md-quote"><Md text={t.replace(/^>\s*/, '')} /></p>);
      else out.push(<p key={`p${out.length}`}><Md text={t} /></p>);
    }
  }
  flush();
  return <div className={`md ${className}`}>{out}</div>;
}

/** An embed's fields: the short ones as number tiles, the rest as panels. `skip`: field names shown elsewhere. */
export function EmbedFields({ embed, skip = [] }: { embed: SiteEmbed; skip?: string[] }) {
  const fields = (embed.fields ?? []).filter((f) => !skip.includes(f.name));
  const tiles = fields.filter((f) => f.inline);
  const blocks = fields.filter((f) => !f.inline);
  return (
    <>
      {tiles.length > 0 && (
        <div className="stat-tiles">
          {tiles.map((f) => <div key={f.name} className="stat-tile"><span>{f.name}</span><strong><Md text={f.value} /></strong></div>)}
        </div>
      )}
      {blocks.length > 0 && (
        <div className="embed-blocks">
          {blocks.map((f) => (
            <section key={f.name} className="panel">
              <h3 className="panel-title"><Md text={f.name} /></h3>
              <MdBlock text={f.value} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** A whole embed as a panel: title, description, fields and footer. */
export function EmbedView({ embed }: { embed: SiteEmbed }) {
  return (
    <section className="panel embed-view">
      {embed.title && <h3 className="panel-title"><Md text={embed.title} /></h3>}
      {embed.description && <MdBlock text={embed.description} className="muted-md" />}
      {(embed.fields ?? []).map((f) => (
        <div key={f.name} className="embed-field">
          <div className="comp-label"><Md text={f.name} /></div>
          <MdBlock text={f.value} />
        </div>
      ))}
      {embed.footer && <p className="muted small">{embed.footer.text}</p>}
    </section>
  );
}
