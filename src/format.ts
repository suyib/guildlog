export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const n0 = (v: number | null | undefined) => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString());
export const pct = (v: number | null | undefined, dp = 0) => (v === null || v === undefined ? '–' : `${v.toFixed(dp)}%`);

export function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}m`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}
