// runtime/content/lib/epic-members.mjs — Nestfolio content (seam #2): epic member-selection + the rule-11
// single-active-epic surface. The orchestrator spine (ring-1) drives whatever `members` array it is handed,
// in order; the ORDER and the core/open/captured filter are Nestfolio backlog semantics (epic/epic_role/
// rank/status), so they live in content and are injected by the adapter — ring-1 stays project-agnostic
// (import-boundary test). Mirrors classify-lane.mjs's placement (also content, also adapter-injected).
const OPEN = new Set(['active', 'queued', 'parking']);
const rankOf = (m) => (m.rank == null ? Infinity : Number(m.rank));
const tier = (s) => (s === 'active' ? 0 : s === 'queued' ? 1 : 2);

/** OPEN core members of `epicId` (role core or unset; captured excluded), in deterministic drive order:
 *  active first, then queued by ascending rank (missing rank last), then parking — alphabetical within a tier.
 *  Shipped/dropped members are excluded so a fresh epic run never re-drives completed work. */
export function selectEpicMembers(items, epicId) {
  return items
    .filter((i) => i.epic === epicId && (i.epic_role ?? 'core') === 'core' && OPEN.has(i.status))
    .sort((a, b) => tier(a.status) - tier(b.status) || rankOf(a) - rankOf(b) || a.id.localeCompare(b.id));
}

/** Ids of every active `type: epic` — the rule-11 / single-active-epic surface (the E1 pre-drive guard). */
export function activeEpics(items) {
  return items.filter((i) => i.type === 'epic' && i.status === 'active').map((i) => i.id).sort((a, b) => a.localeCompare(b));
}
