// The small part of PostgREST the app uses, turned into SQL for a plain Postgres database
// (DATABASE_URL, e.g. Neon). The rest of the code keeps calling rest('table?col=eq.x', …) whichever
// database it runs on. Covered: select (columns, aliases, json -> and ->>), filters eq, neq, gt,
// gte, lt, lte, like, ilike, in, is (and not.), order (asc/desc, nullsfirst/last), limit, offset;
// POST (one row or many, on_conflict with merge-duplicates or ignore-duplicates), PATCH, DELETE,
// and Prefer return=representation. Anything else is refused rather than guessed.

export interface Sql { text: string; params: unknown[]; returns: boolean }
export type Exec = (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[] }>;

const NAME = /^[a-z_][a-z0-9_]*$/i;
const KEY = /^[A-Za-z0-9_]+$/;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);

const ident = (s: string) => {
  if (!NAME.test(s)) throw new Error(`Database: unexpected name "${s}"`);
  return `"${s}"`;
};

/** A column, or a path into a json column: digest->zone, payload->>gatherAt. */
function column(expr: string): string {
  const m = expr.match(/^([a-z_][a-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/i);
  if (!m) throw new Error(`Database: unexpected column "${expr}"`);
  let out = ident(m[1]);
  for (const [, arrow, key] of m[2].matchAll(/(->>?)([A-Za-z0-9_]+)/g)) {
    if (!KEY.test(key)) throw new Error(`Database: unexpected key "${key}"`);
    out += `${arrow}'${key}'`;
  }
  return out;
}

function selectList(select: string | null): string {
  if (!select || select === '*') return '*';
  return select.split(',').map((item) => {
    const [alias, expr] = item.includes(':') ? item.split(':') : [null, item];
    if (expr === '*') return '*';
    const col = column(expr);
    // A json path is returned under its last key (as PostgREST does), or the alias
    const name = alias ?? (expr.includes('->') ? expr.split(/->>?/).pop()! : null);
    return name ? `${col} AS ${ident(name)}` : col;
  }).join(', ');
}

/** Values in a filter: "in.(a,b)" lists, quotes removed. */
const listOf = (v: string) => v.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"(.*)"$/, '$1'));

function where(filters: [string, string][], params: unknown[]): string {
  const parts = filters.map(([key, raw]) => {
    const col = column(key);
    let value = raw;
    let not = false;
    if (value.startsWith('not.')) {
      not = true;
      value = value.slice(4);
    }
    const dot = value.indexOf('.');
    const op = value.slice(0, dot);
    const arg = value.slice(dot + 1);
    // true/false as booleans, so they match boolean columns whichever driver sends them
    const p = (v: unknown) => {
      params.push(v === 'true' ? true : v === 'false' ? false : v);
      return `$${params.length}`;
    };
    let sql: string;
    switch (op) {
      case 'eq': sql = `${col} = ${p(arg)}`; break;
      case 'neq': sql = `${col} <> ${p(arg)}`; break;
      case 'gt': sql = `${col} > ${p(arg)}`; break;
      case 'gte': sql = `${col} >= ${p(arg)}`; break;
      case 'lt': sql = `${col} < ${p(arg)}`; break;
      case 'lte': sql = `${col} <= ${p(arg)}`; break;
      case 'like': sql = `${col} LIKE ${p(arg.replace(/\*/g, '%'))}`; break;
      case 'ilike': sql = `${col} ILIKE ${p(arg.replace(/\*/g, '%'))}`; break;
      case 'in': {
        const list = listOf(arg);
        sql = list.length ? `${col} IN (${list.map((v) => p(v)).join(', ')})` : 'false';
        break;
      }
      case 'is': {
        const v = arg.toLowerCase();
        if (!['null', 'true', 'false'].includes(v)) throw new Error(`Database: unexpected filter "${raw}"`);
        sql = `${col} IS ${v.toUpperCase()}`;
        break;
      }
      default: throw new Error(`Database: unsupported filter "${raw}"`);
    }
    return not ? `NOT (${sql})` : sql;
  });
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}

function orderBy(order: string | null): string {
  if (!order) return '';
  return ` ORDER BY ${order.split(',').map((term) => {
    const [col, ...mods] = term.split('.');
    const dir = mods.includes('desc') ? ' DESC' : mods.includes('asc') ? ' ASC' : '';
    const nulls = mods.includes('nullsfirst') ? ' NULLS FIRST' : mods.includes('nullslast') ? ' NULLS LAST' : '';
    return `${column(col)}${dir}${nulls}`;
  }).join(', ')}`;
}

/** Objects and arrays go into json columns as json; everything else as it is. */
const value = (v: unknown) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

/** The SQL for one PostgREST-style request. */
export function toSql(path: string, init: RequestInit = {}): Sql {
  const [table, query = ''] = path.split('?');
  const t = ident(table);
  const q = new URLSearchParams(query);
  const filters: [string, string][] = [];
  for (const [k, v] of q) if (!RESERVED.has(k)) filters.push([k, v]);
  const method = (init.method ?? 'GET').toUpperCase();
  const prefer = String((init.headers as Record<string, string> | undefined)?.Prefer ?? '');
  const returns = method === 'GET' || prefer.includes('return=representation');
  const returning = returns && method !== 'GET' ? ` RETURNING ${selectList(q.get('select'))}` : '';
  const params: unknown[] = [];
  const limit = q.get('limit') ? ` LIMIT ${Math.max(0, Math.trunc(Number(q.get('limit'))))}` : '';
  const offset = q.get('offset') ? ` OFFSET ${Math.max(0, Math.trunc(Number(q.get('offset'))))}` : '';

  if (method === 'GET') {
    return { text: `SELECT ${selectList(q.get('select'))} FROM ${t}${where(filters, params)}${orderBy(q.get('order'))}${limit}${offset}`, params, returns };
  }
  if (method === 'DELETE') {
    return { text: `DELETE FROM ${t}${where(filters, params)}${returning}`, params, returns };
  }
  const body = init.body ? JSON.parse(String(init.body)) : {};
  if (method === 'PATCH') {
    const cols = Object.keys(body);
    if (!cols.length) throw new Error('Database: nothing to update');
    const set = cols.map((c) => {
      params.push(value(body[c]));
      return `${ident(c)} = $${params.length}`;
    }).join(', ');
    return { text: `UPDATE ${t} SET ${set}${where(filters, params)}${returning}`, params, returns };
  }
  if (method === 'POST') {
    const rows: Record<string, unknown>[] = Array.isArray(body) ? body : [body];
    if (!rows.length) return { text: 'SELECT 1 WHERE false', params, returns };
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    // Missing keys get the column's default, as PostgREST does for a single row
    const values = rows.map((r) => `(${cols.map((c) => {
      if (!(c in r)) return 'DEFAULT';
      params.push(value(r[c]));
      return `$${params.length}`;
    }).join(', ')})`).join(', ');
    let conflict = '';
    const target = q.get('on_conflict');
    if (target && prefer.includes('resolution=')) {
      const keys = target.split(',').map((c) => c.trim());
      const update = cols.filter((c) => !keys.includes(c));
      conflict = prefer.includes('resolution=ignore-duplicates') || !update.length
        ? ` ON CONFLICT (${keys.map(ident).join(', ')}) DO NOTHING`
        : ` ON CONFLICT (${keys.map(ident).join(', ')}) DO UPDATE SET ${update.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}`;
    }
    return { text: `INSERT INTO ${t} (${cols.map(ident).join(', ')}) VALUES ${values}${conflict}${returning}`, params, returns };
  }
  throw new Error(`Database: unsupported method ${method}`);
}

// Postgres types returned as text by drivers that PostgREST would give as numbers
const NUMERIC = new Set([20, 21, 23, 700, 701, 1700]);

/** Run one request on Postgres and shape the answer like PostgREST's (null when nothing's returned). */
export async function pgRest(exec: Exec, path: string, init: RequestInit = {}): Promise<any> {
  const { text, params, returns } = toSql(path, init);
  const res = await exec(text, params);
  if (!returns) return null;
  const numeric = new Set(res.fields.filter((f) => NUMERIC.has(f.dataTypeID)).map((f) => f.name));
  return res.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = v instanceof Date ? v.toISOString() : numeric.has(k) && typeof v === 'string' ? Number(v) : v;
    }
    return out;
  });
}
