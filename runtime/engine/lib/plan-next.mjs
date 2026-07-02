// runtime/engine/lib/plan-next.mjs — the planner (§8). next + rank + read-time impact. Only `rank` is
// stored (law §13.2); impact/blocks/freshness/epicPull are computed at read time — a view, not a field.
// Maps to backlog-next Step-1 pick + the BACKLOG.md render. blastOf is the injected project measure.
const OPEN = new Set(['active', 'queued', 'parking']);
const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export function planNext({ backlog, registry, env }) {
  const active = backlog.find((i) => i.status === 'active' && i.type !== 'epic');
  if (active) {
    if (active.epic && env?.activeEpics?.includes(active.epic)) return { next: null, redirect: { kind: 'epic', id: active.epic }, ranked: [], impacts: {} };
    return { next: active.id, ranked: rankedQueued(backlog), impacts: {} };
  }
  const queued = rankedQueued(backlog);
  const pick = queued[0] ?? null;
  if (pick?.type === 'epic') return { next: null, redirect: { kind: 'epic', id: pick.id }, ranked: queued, impacts: {} };
  return { next: pick?.id ?? null, ranked: queued, impacts: {} };
}

function rankedQueued(backlog) {
  return backlog.filter((i) => i.status === 'queued')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
}

export function computeImpact({ item, backlog, blastOf, refResolves = () => true }) {
  const blocks = backlog.filter((i) => (i.references ?? []).some((r) => r.includes(item.id))).length;
  const blast = blastOf ? blastOf(toGlobs(item.scope)) : 0;
  const freshness = (item.references ?? []).every((r) => refResolves(r)) ? 'fresh' : 'stale';
  const epicPull = item.epic ? backlog.filter((i) => i.epic === item.epic && (i.epic_role ?? 'core') === 'core' && i.id !== item.id && OPEN.has(i.status)).length : 0;
  return { blocks, blast, freshness, epicPull };
}

export function renderIndex({ backlog }) {
  const section = (title, pred) => `## ${title}\n` + backlog.filter(pred).map((i) => `- ${i.id} (${i.status})`).join('\n');
  return [section('ACTIVE', (i) => i.status === 'active'), section('QUEUED', (i) => i.status === 'queued'),
    section('LATER', (i) => i.status === 'parking')].join('\n\n') + '\n';
}
