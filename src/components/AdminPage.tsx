// Admin (officers, raid leaders and above): everyone who has signed in or used the bot, with their rank, and
// editing for anyone below you: rank, display name, officer note, site access and characters.
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { AdminEdit, AdminOverview, AdminPerson, AdminSignIn, BugReport, GuildSettings, Rank } from '../../server/types';
import { RANK_LABEL, loadAdmin, saveAdminEdit } from '../api';
import Glyph from './Glyph';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`;
};
const RESULT: Record<AdminSignIn['result'], { label: string; cls: string }> = {
  ok: { label: 'Signed in', cls: 'badge-ok' },
  not_member: { label: 'Not in the server', cls: 'badge-warn' },
  wrong_password: { label: 'Wrong password', cls: 'badge-warn' },
  error: { label: 'Failed', cls: 'badge-bad' },
};
const RANK_ORDER: Rank[] = ['admin', 'guild_master', 'officer', 'raid_leader', 'raid_assist', 'loot_council', 'raider'];

export default function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [rankFilter, setRankFilter] = useState<Rank | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const refresh = () => loadAdmin().then(setData).catch((e) => setError((e as Error).message));
  useEffect(() => {
    refresh();
  }, []);

  const people = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    return data.people
      .filter((p) => rankFilter === 'all' || p.rank === rankFilter)
      .filter((p) => !f || `${p.name} ${p.discordName} ${p.username ?? ''} ${p.id} ${p.guild ?? ''} ${p.characters.map((c) => c.name).join(' ')}`.toLowerCase().includes(f))
      .sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) || (b.lastSignIn ?? b.firstClaim ?? '').localeCompare(a.lastSignIn ?? a.firstClaim ?? ''));
  }, [data, filter, rankFilter]);

  if (error) return <section className="panel"><h1>Admin</h1><p className="error">{error}</p></section>;
  if (!data) return <section className="panel"><h1>Admin</h1><p className="muted">Loading…</p></section>;

  const week = Date.now() - 7 * 86_400_000;
  const active = data.people.filter((p) => p.lastSignIn && new Date(p.lastSignIn).getTime() >= week).length;
  const count = (r: Rank) => data.people.filter((p) => p.rank === r).length;
  const problems = data.signIns.filter((s) => s.result !== 'ok').length;
  const log = data.signIns.filter((s) => !onlyProblems || s.result !== 'ok');

  return (
    <>
      <section className="panel">
        <h1>Admin</h1>
        <p className="help">
          You&rsquo;re {data.me.rank === 'admin' ? 'an' : 'a'} {RANK_LABEL[data.me.rank]}. {data.me.rank === 'admin' ? 'You can change everyone.' : `You can change anyone below ${RANK_LABEL[data.me.rank]}.`} Click a person to edit them.
        </p>
      </section>

      <div className="kpis">
        <Kpi glyph="users" label="People" value={String(data.people.length)} sub={`${active} active this week`} />
        <Kpi glyph="shield" label="Leadership" value={String(count('guild_master') + count('officer') + count('raid_leader'))} sub={`${count('guild_master')} GM, ${count('officer')} officer${count('officer') === 1 ? '' : 's'}, ${count('raid_leader')} raid lead${count('raid_leader') === 1 ? '' : 's'}`} />
        <Kpi glyph="users" label="Raiders" value={String(count('raider') + count('raid_assist') + count('loot_council'))} sub={`${count('raid_assist')} raid assist, ${count('loot_council')} loot council, ${data.people.filter((p) => p.blocked).length} access off`} />
        <Kpi glyph="alert" label="Problems" value={String(problems)} sub={`failed sign-ins, last ${data.signInLogDays} days`} />
      </div>

      {(data.me.rank === 'admin' || data.me.rank === 'guild_master') && data.guild && <GuildDetails guild={data.guild} onSaved={refresh} />}

      <BugReports bugs={data.bugs ?? []} canDelete={data.me.rank === 'admin' || data.me.rank === 'guild_master'} onSaved={refresh} />

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">People</h2>
          <div className="row admin-filters">
            <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value as Rank | 'all')} aria-label="Rank">
              <option value="all">All ranks</option>
              {RANK_ORDER.map((r) => <option key={r} value={r}>{RANK_LABEL[r]}</option>)}
            </select>
            <input className="filter" placeholder="Filter: name, ID, character" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter people" />
          </div>
        </div>
        {people.length === 0 ? <p className="muted">Nobody here.</p> : (
          <div className="scroll">
            <table className="grid admin-table">
              <thead>
                <tr><th>Person</th><th>Rank</th><th>Connected</th><th>Last signed in</th><th className="r">Sign-ins</th><th>Characters</th><th></th></tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <Fragment key={p.id}>
                    <tr className={`${p.editable ? 'clickable' : ''}${open === p.id ? ' on' : ''}${p.blocked ? ' blocked' : ''}`} onClick={() => p.editable && setOpen(open === p.id ? null : p.id)}>
                      <td>
                        <span className="admin-person">
                          {p.avatar ? <img src={p.avatar} width={24} height={24} alt="" /> : <span className="side-user-blank" aria-hidden="true"><Glyph name="users" size={14} /></span>}
                          <span>
                            <strong>{p.name}</strong>
                            <span className="muted small">{p.displayName ? `${p.discordName} · ` : ''}{p.username ? `@${p.username} · ` : ''}{p.id}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`badge rank-${p.rank}`}>{RANK_LABEL[p.rank]}</span>
                        {p.rankFrom === 'set here' && <span className="muted small"> set here</span>}
                        {p.blocked && <span className="badge badge-bad"> No access</span>}
                      </td>
                      <td className="muted">
                        {p.firstSignIn ? <>Site {day(p.firstSignIn)}</> : null}
                        {p.firstSignIn && p.firstClaim ? <br /> : null}
                        {p.firstClaim ? <>Bot {day(p.firstClaim)}</> : null}
                        {!p.firstSignIn && !p.firstClaim ? '–' : null}
                      </td>
                      <td className="muted">{p.lastSignIn ? <span title={when(p.lastSignIn)}>{ago(p.lastSignIn)}</span> : 'Never'}</td>
                      <td className="r">{p.signIns || '–'}</td>
                      <td>
                        {p.characters.length === 0 ? <span className="muted">–</span> : p.characters.map((c) => (
                          <span key={c.id} className={`admin-char ${c.status}`} title={`${c.name}${c.realm ? `-${c.realm}` : ''}: ${c.status}`}>{c.name}</span>
                        ))}
                      </td>
                      <td className="r">{p.editable ? <span className="link-like small">{open === p.id ? 'Close' : 'Edit'}</span> : null}</td>
                    </tr>
                    {open === p.id && (
                      <tr className="admin-edit-row">
                        <td colSpan={7}>
                          <PersonEditor person={p} assignable={data.me.assignable} self={p.id === data.me.id} onSaved={refresh} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Sign-in log</h2>
          <label className="check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only problems</label>
        </div>
        <p className="muted small">The last {data.signInLogDays} days, newest first. Older entries are removed automatically.</p>
        {log.length === 0 ? <p className="muted">Nothing here.</p> : (
          <div className="scroll">
            <table className="grid admin-table">
              <thead><tr><th>When</th><th>Who</th><th>Server</th><th>How</th><th>Result</th></tr></thead>
              <tbody>
                {log.map((s) => (
                  <tr key={s.id}>
                    <td className="muted">{when(s.at)}</td>
                    <td>{s.username ? <>{s.username} <span className="muted small">{s.discord_id}</span></> : <span className="muted">–</span>}</td>
                    <td>{s.guild_name ?? s.guild_id ?? <span className="muted">–</span>}</td>
                    <td>{s.kind === 'discord' ? 'Discord' : 'Guild password'}</td>
                    <td>
                      <span className={`badge ${RESULT[s.result].cls}`}>{RESULT[s.result].label}</span>
                      {s.detail && <span className="muted small"> {s.detail}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Everything you can change about one person. Each change saves on its own. */
function PersonEditor({ person: p, assignable, self, onSaved }: { person: AdminPerson; assignable: Rank[]; self: boolean; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(p.displayName ?? '');
  const [note, setNote] = useState(p.note ?? '');
  const [newChar, setNewChar] = useState('');
  const [newRealm, setNewRealm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(edit: AdminEdit) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await saveAdminEdit(edit);
      setMessage({ ok: true, text: `Done: ${r.done.replace(/<@\d+>/g, '').replace(/\(\s*\)/g, '').trim()}.` });
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-edit">
      <div className="admin-edit-grid">
        <label>
          Rank
          {p.rankFrom === 'site admin' ? (
            <span className="muted small">Admin (set with SITE_ADMIN_IDS in Vercel)</span>
          ) : (
            <select disabled={busy} value={p.rankSet ?? ''} onChange={(e) => save({ action: 'rank', id: p.id, rank: (e.target.value || null) as Rank | null })}>
              <option value="">From Discord{p.rankSet ? '' : ` (${RANK_LABEL[p.rank]})`}</option>
              {assignable.map((r) => <option key={r} value={r}>{RANK_LABEL[r]}</option>)}
            </select>
          )}
        </label>
        <label>
          Display name
          <span className="row">
            <input value={displayName} maxLength={40} placeholder={p.discordName} onChange={(e) => setDisplayName(e.target.value)} />
            <button type="button" className="ghost" disabled={busy || displayName === (p.displayName ?? '')} onClick={() => save({ action: 'name', id: p.id, displayName: displayName || null })}>Save</button>
          </span>
        </label>
        <label>
          Site access
          <span>
            {self ? <span className="muted small">You can&rsquo;t turn off your own access.</span> : (
              <button type="button" className={p.blocked ? 'secondary' : 'ghost danger'} disabled={busy} onClick={() => save({ action: 'blocked', id: p.id, blocked: !p.blocked })}>
                {p.blocked ? 'Turn access back on' : 'Turn off access'}
              </button>
            )}
          </span>
        </label>
      </div>

      <label className="admin-note">
        Officer note <span className="muted small">(only officers and above see this)</span>
        <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="e.g. trial raider since October, main is the priest" />
        <button type="button" className="ghost" disabled={busy || note === (p.note ?? '')} onClick={() => save({ action: 'note', id: p.id, note: note || null })}>Save note</button>
      </label>

      <div>
        <div className="comp-label">Characters</div>
        {p.characters.length === 0 && <p className="muted small">No characters yet.</p>}
        <ul className="admin-chars">
          {p.characters.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>{c.realm && <span className="muted small"> {c.realm}</span>}
              <span className={`badge ${c.status === 'approved' ? 'badge-ok' : c.status === 'pending' ? 'badge-warn' : 'badge-plain'}`}>{c.status === 'approved' ? 'Approved' : c.status === 'pending' ? 'Waiting' : 'Rejected'}</span>
              {c.status !== 'approved' && <button type="button" className="ghost" disabled={busy} onClick={() => save({ action: 'claim', id: p.id, claimId: c.id, status: 'approved' })}>Approve</button>}
              {c.status === 'pending' && <button type="button" className="ghost" disabled={busy} onClick={() => save({ action: 'claim', id: p.id, claimId: c.id, status: 'rejected' })}>Reject</button>}
              <button type="button" className="ghost danger" disabled={busy} onClick={() => save({ action: 'claim', id: p.id, claimId: c.id, status: 'removed' })}>Remove</button>
            </li>
          ))}
        </ul>
        <form className="row admin-add-char" onSubmit={(e) => { e.preventDefault(); if (newChar.trim()) save({ action: 'addCharacter', id: p.id, character: newChar, realm: newRealm || null }).then(() => { setNewChar(''); setNewRealm(''); }); }}>
          <input value={newChar} maxLength={24} placeholder="Add a character" onChange={(e) => setNewChar(e.target.value)} aria-label="Character name" />
          <input value={newRealm} maxLength={40} placeholder="Realm (optional)" onChange={(e) => setNewRealm(e.target.value)} aria-label="Realm" />
          <button type="submit" className="ghost" disabled={busy || !newChar.trim()}>Add</button>
        </form>
      </div>

      {message && <p className={message.ok ? 'good-note small' : 'error'}>{message.text}</p>}
    </div>
  );
}

function Kpi({ glyph, label, value, sub }: { glyph: 'users' | 'shield' | 'alert'; label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><span className="kpi-icon"><Glyph name={glyph} size={18} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

/** Bug reports from the Report a bug button in Discord: open ones first, each one a card to act on. */
/** Shrink a picture to a 128px square (cropped to the middle) as a small data: image. */
function squareIcon(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/webp', 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file isn\u2019t a picture this browser can read.'));
    };
    img.src = url;
  });
}

/** The guild's name, picture and about text (guild masters and admins). Empty name or picture: Discord's. */
function GuildDetails({ guild, onSaved }: { guild: AdminOverview['guild']; onSaved: () => void }) {
  const [form, setForm] = useState<GuildSettings>(guild.settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const icon = form.icon ?? guild.discord?.icon ?? null;
  const changed = JSON.stringify(form) !== JSON.stringify(guild.settings);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const icon = await squareIcon(file);
      setForm((f) => ({ ...f, icon }));
      setMsg(null);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveAdminEdit({ action: 'guild', ...form });
      setMsg({ ok: true, text: 'Saved. The home page shows these now.' });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel-title">Guild details</h2>
      <p className="muted small">The name and picture come from the Discord server. Set them here to use something else; clear them to go back to Discord&rsquo;s.</p>
      <div className="guild-form">
        <div className="guild-icon">
          {icon ? <img src={icon} width={72} height={72} alt="Guild picture" /> : <span className="kpi-icon big"><Glyph name="users" size={24} /></span>}
          <label className="button ghost">
            Upload picture
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {form.icon && <button type="button" className="ghost" onClick={() => setForm((f) => ({ ...f, icon: null }))}>Use Discord&rsquo;s</button>}
          <span className="muted small">{form.icon ? 'Custom picture' : 'From Discord'}</span>
        </div>
        <div className="guild-fields">
          <label>
            Name
            <input value={form.name ?? ''} maxLength={60} placeholder={guild.discord?.name ?? 'Guild name'} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value || null }))} />
            <span className="muted small">{form.name ? 'Custom name' : `From Discord${guild.discord ? `: ${guild.discord.name}` : ''}`}</span>
          </label>
          <label>
            About
            <textarea value={form.about ?? ''} maxLength={600} rows={3} placeholder="A line or two about the guild, shown under its name on the home page" onChange={(e) => setForm((f) => ({ ...f, about: e.target.value || null }))} />
          </label>
          <div className="row wrap-center">
            <button type="button" disabled={busy || !changed} onClick={save}>{busy ? 'Saving\u2026' : 'Save'}</button>
            {changed && <button type="button" className="ghost" disabled={busy} onClick={() => setForm(guild.settings)}>Undo changes</button>}
            {msg && <span className={msg.ok ? 'muted small' : 'error small'}>{msg.text}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function BugReports({ bugs, canDelete, onSaved }: { bugs: BugReport[]; canDelete: boolean; onSaved: () => void }) {
  const [show, setShow] = useState<'open' | 'resolved' | 'all'>('open');
  const open = bugs.filter((b) => b.status === 'open').length;
  const list = bugs.filter((b) => show === 'all' || b.status === show);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Bug reports{open ? ` (${open} open)` : ''}</h2>
        <div className="seg" role="group" aria-label="Show">
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <button key={s} type="button" className={show === s ? 'on' : ''} aria-pressed={show === s} onClick={() => setShow(s)}>
              {s === 'open' ? 'Open' : s === 'resolved' ? 'Fixed' : 'All'}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">Sent with the Report a bug button in Discord (under each raid summary and in /help).</p>
      {list.length === 0 ? <p className="muted">{show === 'open' ? 'No open bug reports.' : 'Nothing here.'}</p> : (
        <div className="bug-grid">
          {list.map((b) => <BugCard key={b.id} bug={b} canDelete={canDelete} onSaved={onSaved} />)}
        </div>
      )}
    </section>
  );
}

function BugCard({ bug: b, canDelete, onSaved }: { bug: BugReport; canDelete: boolean; onSaved: () => void }) {
  const [note, setNote] = useState(b.note ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(edit: AdminEdit) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await saveAdminEdit(edit);
      setMessage({ ok: true, text: r.done.charAt(0).toUpperCase() + r.done.slice(1) + '.' });
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }
  const noteValue = note.trim() || null;
  return (
    <article className={`bug-card${b.status === 'resolved' ? ' resolved' : ''}`}>
      <header className="bug-head">
        <span className={`badge ${b.status === 'open' ? 'badge-warn' : 'badge-ok'}`}>{b.status === 'open' ? 'Open' : 'Fixed'}</span>
        <span className="muted small" title={when(b.at)}>{ago(b.at)} · {b.username ?? 'Unknown'}{b.place ? ` · ${b.place}` : ''}</span>
      </header>
      <p className="bug-what">{b.what}</p>
      {b.doing && <p className="muted small bug-what"><strong>Doing:</strong> {b.doing}</p>}
      {b.raid && (
        <div className="raid-card-links">
          <a className="button ghost" href={`/?log=${encodeURIComponent(`https://${b.raid.host}/reports/${b.raid.code}`)}`}>Open the raid</a>
          <a className="button ghost" href={`https://${b.raid.host}/reports/${b.raid.code}`} target="_blank" rel="noreferrer">Warcraft Logs</a>
        </div>
      )}
      <label className="bug-note">
        <span className="comp-label">Note</span>
        <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="What was done about it (sent with Fix & tell them)" />
      </label>
      {b.status === 'resolved' && b.resolvedAt && <p className="muted small">Fixed {ago(b.resolvedAt)}{b.resolvedBy ? ` by ${b.resolvedBy}` : ''}.</p>}
      <div className="raid-card-links">
        {b.status === 'open' ? (
          <>
            {b.discordId && <button type="button" disabled={busy} onClick={() => save({ action: 'bug', id: b.id, status: 'resolved', note: noteValue, tell: true })}>Fix &amp; tell them</button>}
            <button type="button" className="ghost" disabled={busy} onClick={() => save({ action: 'bug', id: b.id, status: 'resolved', note: noteValue })}>Mark fixed</button>
          </>
        ) : (
          <button type="button" className="ghost" disabled={busy} onClick={() => save({ action: 'bug', id: b.id, status: 'open', note: noteValue })}>Reopen</button>
        )}
        {noteValue !== (b.note ?? null) && <button type="button" className="ghost" disabled={busy} onClick={() => save({ action: 'bug', id: b.id, note: noteValue })}>Save note</button>}
        {canDelete && !confirmDelete && <button type="button" className="ghost danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
        {canDelete && confirmDelete && (
          <>
            <button type="button" className="ghost danger" disabled={busy} onClick={() => save({ action: 'bugDelete', id: b.id })}>Yes, delete</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        )}
      </div>
      {message && <p className={message.ok ? 'muted small' : 'error'}>{message.text}</p>}
    </article>
  );
}
