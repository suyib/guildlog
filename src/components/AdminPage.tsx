// Admin (site admins only): everyone who has signed in or used the bot, which Discord server
// they're from, when they first connected and last signed in, and the sign-in log.
import { useEffect, useMemo, useState } from 'react';
import type { AdminOverview, AdminSignIn } from '../../server/types';
import { loadAdmin } from '../api';
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

interface Person {
  id: string;
  name: string;
  username: string | null;
  avatar: string | null;
  guild: string | null;
  officer: boolean;
  firstSignIn: string | null;
  lastSignIn: string | null;
  signIns: number;
  firstClaim: string | null;
  characters: { name: string; realm: string | null; status: string }[];
}

export default function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    loadAdmin().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  // Everyone: site sign-ins, plus people who've only used the bot (claimed a character)
  const people = useMemo<Person[]>(() => {
    if (!data) return [];
    const out = new Map<string, Person>();
    for (const u of data.users) {
      out.set(u.discord_id, {
        id: u.discord_id, name: u.name || u.username, username: u.username, guild: u.guild_name ?? u.guild_id,
        avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=64` : null,
        officer: u.officer, firstSignIn: u.first_seen, lastSignIn: u.last_seen, signIns: u.sign_ins, firstClaim: null, characters: [],
      });
    }
    for (const [id, b] of Object.entries(data.bot)) {
      const p = out.get(id) ?? { id, name: b.name, username: null, avatar: null, guild: null, officer: false, firstSignIn: null, lastSignIn: null, signIns: 0, firstClaim: null, characters: [] };
      p.firstClaim = b.firstClaim;
      p.characters = b.characters;
      out.set(id, p);
    }
    const f = filter.trim().toLowerCase();
    return [...out.values()]
      .filter((p) => !f || `${p.name} ${p.username ?? ''} ${p.id} ${p.guild ?? ''} ${p.characters.map((c) => c.name).join(' ')}`.toLowerCase().includes(f))
      .sort((a, b) => (b.lastSignIn ?? b.firstClaim ?? '').localeCompare(a.lastSignIn ?? a.firstClaim ?? ''));
  }, [data, filter]);

  if (error) return <section className="panel"><h1>Admin</h1><p className="error">{error}</p></section>;
  if (!data) return <section className="panel"><h1>Admin</h1><p className="muted">Loading…</p></section>;

  const week = Date.now() - 7 * 86_400_000;
  const active = data.users.filter((u) => new Date(u.last_seen).getTime() >= week).length;
  const guilds = new Set(data.users.map((u) => u.guild_id).filter(Boolean)).size;
  const problems = data.signIns.filter((s) => s.result !== 'ok').length;
  const log = data.signIns.filter((s) => !onlyProblems || s.result !== 'ok');

  return (
    <>
      <section className="panel">
        <h1>Admin</h1>
        <p className="help">Everyone who has signed in to the site or used the bot. Only site admins (SITE_ADMIN_IDS) can see this page.</p>
      </section>

      <div className="kpis">
        <Kpi glyph="users" label="People" value={String(people.length)} sub={`${data.users.length} signed in to the site`} />
        <Kpi glyph="clock" label="Active this week" value={String(active)} sub="signed in in the last 7 days" />
        <Kpi glyph="shield" label="Officers" value={String(data.users.filter((u) => u.officer).length)} sub="at their last sign-in" />
        <Kpi glyph="alert" label="Problems" value={String(problems)} sub={`failed sign-ins, last ${data.signInLogDays} days`} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">People{guilds > 1 ? ` across ${guilds} servers` : ''}</h2>
          <input className="filter" placeholder="Filter: name, ID, server, character" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter people" />
        </div>
        {people.length === 0 ? <p className="muted">Nobody yet.</p> : (
          <div className="scroll">
            <table className="grid admin-table">
              <thead>
                <tr><th>Person</th><th>Server</th><th>Role</th><th>Connected</th><th>Last signed in</th><th className="r">Sign-ins</th><th>Characters</th></tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="admin-person">
                        {p.avatar ? <img src={p.avatar} width={24} height={24} alt="" /> : <span className="side-user-blank" aria-hidden="true"><Glyph name="users" size={14} /></span>}
                        <span>
                          <strong>{p.name}</strong>
                          <span className="muted small">{p.username ? `@${p.username} · ` : ''}{p.id}</span>
                        </span>
                      </span>
                    </td>
                    <td>{p.guild ?? <span className="muted">–</span>}</td>
                    <td>{p.signIns ? <span className={`badge ${p.officer ? 'badge-ok' : 'badge-plain'}`}>{p.officer ? 'Officer' : 'Member'}</span> : <span className="muted small">Bot only</span>}</td>
                    <td className="muted">
                      {p.firstSignIn ? <>Site {day(p.firstSignIn)}</> : null}
                      {p.firstSignIn && p.firstClaim ? <br /> : null}
                      {p.firstClaim ? <>Bot {day(p.firstClaim)}</> : null}
                    </td>
                    <td className="muted">{p.lastSignIn ? <span title={when(p.lastSignIn)}>{ago(p.lastSignIn)}</span> : 'Never'}</td>
                    <td className="r">{p.signIns || '–'}</td>
                    <td>
                      {p.characters.length === 0 ? <span className="muted">–</span> : p.characters.map((c) => (
                        <span key={`${c.name}-${c.realm}`} className={`admin-char ${c.status}`} title={`${c.name}${c.realm ? `-${c.realm}` : ''}: ${c.status}`}>{c.name}</span>
                      ))}
                    </td>
                  </tr>
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
                      {s.detail && s.detail !== 'officer' && <span className="muted small"> {s.detail}</span>}
                      {s.detail === 'officer' && <span className="muted small"> as officer</span>}
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

function Kpi({ glyph, label, value, sub }: { glyph: 'users' | 'clock' | 'shield' | 'alert'; label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><span className="kpi-icon"><Glyph name={glyph} size={18} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
