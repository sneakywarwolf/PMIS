// Per-user dashboard layout: which sections are hidden and in what order. Pure, so it can be tested with `npm test`.

export const SECTIONS = [
  { id: 'rankings', label: 'Leaderboards' },
  { id: 'myteam', label: 'My Team' },
  { id: 'engagements', label: 'Engagements' },
  { id: 'charts', label: 'Charts' },
  { id: 'tls', label: 'Team Leads' },
  { id: 'heatmap', label: 'Findings Heatmap' },
  { id: 'main', label: 'Projects & Quick Actions' },
  { id: 'activity', label: 'Recent Activity' },
] as const;

export type Prefs = { order: string[]; hidden: string[] };

const IDS: string[] = SECTIONS.map((s) => s.id);

export const DEFAULT_PREFS: Prefs = { order: IDS, hidden: [] };

/** Turns whatever was stored (possibly stale or tampered) into valid prefs: known ids only, none missing. */
export function normalize(raw: unknown): Prefs {
  const r = (raw ?? {}) as Partial<Prefs>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && IDS.includes(x)) : []);
  const order = [...new Set(strings(r.order))];
  // A section added after the user saved their layout goes right after the section that precedes it by default (not at the very end).
  IDS.forEach((id, i) => {
    if (order.includes(id)) return;
    const prev = i > 0 ? order.indexOf(IDS[i - 1]) : -1;
    order.splice(prev + 1, 0, id);
  });
  return { order, hidden: [...new Set(strings(r.hidden))] };
}

export function move(order: string[], id: string, dir: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
