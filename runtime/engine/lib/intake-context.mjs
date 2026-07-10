// runtime/engine/lib/intake-context.mjs — ring-1, pure. The deterministic context-loader feeding the
// intake judgment seam (WS-1 design §3, decision D-A). Legacy backlog-add greps the active epic + reads
// its done_when/scope + runs the closure-predicate before classifying; this module computes that context
// deterministically from the already-read item store so the judge decides on pre-computed facts instead
// of grepping. No I/O — `backlog` is the readItems() array (injected). readItems exposes frontmatter only,
// so the root-cause signal for theme epics / orphans is the `notes:` field.

/** Deterministic decision context for a finding: the active epic (for fold + the closure-predicate), the
 *  parking theme epics (for join-theme), and the parking orphans (for mint-aggregation). Pure. */
export function loadIntakeContext({ backlog }) {
  // The active epic = the single active type:epic (single-active law; cf. activePartition in scope-gate.mjs).
  const active = backlog.find((i) => i.status === 'active' && i.type === 'epic') ?? null;
  const activeEpic = active
    ? { id: active.id, done_when: active.done_when ?? null, scope: active.scope ?? null, out_of_scope: active.out_of_scope ?? [] }
    : null;
  const themeEpics = backlog
    .filter((i) => i.status === 'parking' && i.type === 'epic')
    .map((i) => ({ id: i.id, notes: i.notes ?? '', scope: i.scope ?? null, done_when: i.done_when ?? null }));
  const orphans = backlog
    .filter((i) => i.status === 'parking' && i.type !== 'epic' && !i.epic)
    .map((i) => ({ id: i.id, notes: i.notes ?? '' }));
  return { activeEpic, themeEpics, orphans };
}

/** Render the route-classification prompt for the judgment seam, embedding the deterministic context so
 *  the judge runs the closure-predicate (core vs captured) and root-cause matching without grepping. */
export function renderIntakePrompt({ finding, context }) {
  const { activeEpic, themeEpics, orphans } = context;
  const epicBlock = activeEpic
    ? `ACTIVE EPIC "${activeEpic.id}":\n  done_when: ${JSON.stringify(activeEpic.done_when)}\n  scope: ${JSON.stringify(activeEpic.scope)}\n  out_of_scope: ${JSON.stringify(activeEpic.out_of_scope)}\n  Closure-predicate test: epicRole="core" if leaving this finding undone would make a done_when clause literally false (everything in scope qualifies, plus anything else done_when requires); epicRole="captured" only if genuinely orthogonal to done_when. When unsure, choose "core".`
    : 'ACTIVE EPIC: none (the "fold" route is unavailable — there is no active epic to fold into).';
  const themeBlock = themeEpics.length
    ? `PARKING THEME EPICS (for "join-theme" by shared root cause):\n${themeEpics.map((t) => `  - ${t.id}: ${t.notes}`).join('\n')}`
    : 'PARKING THEME EPICS: none.';
  const orphanBlock = orphans.length
    ? `PARKING ORPHANS (for "mint-aggregation" by shared root cause):\n${orphans.map((o) => `  - ${o.id}: ${o.notes}`).join('\n')}`
    : 'PARKING ORPHANS: none.';
  return [
    'Classify this finding into a route (fold|join-theme|mint-aggregation|orphan|split|discard) per the backlog-add epic-aware router.',
    `FINDING: ${finding.detail}`,
    `FINDING SCOPE: ${JSON.stringify(finding.scope)}`,
    epicBlock,
    themeBlock,
    orphanBlock,
    'Return JSON {route, epic?, epicRole?, splitInto?, rationale}. Every epic-attaching route (fold, join-theme, mint-aggregation) MUST set epicRole per the closure-predicate above — a member with an omitted epicRole silently defaults to "core". fold → epic=the active epic id + epicRole. join-theme → epic=the matching theme epic id + epicRole. mint-aggregation → epic=a NEW aggregation epic id + epicRole, and name the clustered orphans in rationale. split → splitInto=[suffixes]. orphan/discard → omit epic.',
  ].join('\n\n');
}
