// runtime/engine/lib/themes.mjs — the cold-path clustering procedure + epic-close leftovers spin-out
// (spec §7 Hole #2). The all-vs-all sibling of intake.mjs's per-finding hot-path: selectClusters =
// JUDGMENT (seamed via capabilities.execute, same convention as selectRoute); gatherParkingSurface /
// shapeThemeMutations / spinOutLeftovers = PURE deterministic cores. Ring-1 produces abstract Item
// mutations; the frontmatter write is the adapter binding (run-themes.mjs).

const isEpic = (i) => i.type === 'epic';
const isLeftovers = (i) => isEpic(i) && i.id.endsWith('-leftovers');

/** Partition the parking lot into the surfaces a clustering pass reasons over. */
export function gatherParkingSurface(backlog) {
  const orphans = backlog.filter((i) => i.status === 'parking' && !isEpic(i) && !i.epic);
  const leftoversEpics = backlog.filter((i) => i.status === 'parking' && isLeftovers(i));
  const leftoversIds = new Set(leftoversEpics.map((e) => e.id));
  const leftoversMembers = backlog.filter((i) => i.epic && leftoversIds.has(i.epic));
  const existingThemes = backlog.filter((i) => i.status === 'parking' && isEpic(i) && !isLeftovers(i));
  return { orphans, leftoversEpics, leftoversMembers, existingThemes };
}

/** Pure: a judge's cluster decisions → abstract Item mutations (new theme epics + member repoints). */
export function shapeThemeMutations({ clusters }) {
  const mints = [], repoints = [];
  for (const c of clusters ?? []) {
    if (c.action === 'mint') {
      mints.push({
        id: c.themeId, type: 'epic', status: 'parking',
        done_when: c.doneWhen ?? `resolve the shared root cause across: ${(c.absorbs ?? []).join(', ')}`,
        scope: c.scope ?? '', out_of_scope: c.outOfScope ?? [],
      });
    }
    for (const id of c.absorbs ?? []) repoints.push({ id, epic: c.themeId, epic_role: 'core' });
  }
  return { mints, repoints };
}

/** Pure: the epic-close captured-audit — spin genuinely-orthogonal captured members into <epic>-leftovers. */
export function spinOutLeftovers({ epicId, capturedMembers }) {
  if (!capturedMembers.length) return { leftoversEpic: null, repoints: [] };
  const leftoversId = `${epicId}-leftovers`;
  const leftoversEpic = {
    id: leftoversId, type: 'epic', status: 'parking',
    done_when: `re-cluster the orthogonal members spun out of ${epicId}`, scope: '', out_of_scope: [],
  };
  const repoints = capturedMembers.map((m) => ({ id: m.id, epic: leftoversId, epic_role: 'core' }));
  return { leftoversEpic, repoints };
}

/** Judgment seam — mirrors intake.mjs selectRoute: build a Task, execute, JSON.parse the summary. */
export async function selectClusters({ orphans, leftoversMembers, existingThemes, capabilities }) {
  const items = [...orphans, ...leftoversMembers];
  const task = {
    id: `themes-${items.length}`,
    scope: ['docs/backlog/**'],
    prompt: `Cluster these parking-lot items by shared ROOT CAUSE (not symptom/service) per the backlog-themes skill. Clusters must have >=2 members; singletons stay orphans. You may EXTEND an existing theme epic instead of minting a new one. Return JSON {clusters:[{themeId, action:'mint'|'extend', doneWhen?, scope?, outOfScope?, absorbs:[ids], rationale}]}. Items: ${JSON.stringify(items.map((i) => ({ id: i.id, type: i.type, notes: i.notes })))}. Existing themes: ${JSON.stringify(existingThemes.map((e) => e.id))}.`,
    payload: { orphans, leftoversMembers, existingThemes },
  };
  const result = await capabilities.execute(task);
  const d = JSON.parse(result.summary);   // seam convention: decision as JSON in summary
  return { clusters: d.clusters ?? [], rationale: d.rationale ?? result.summary };
}

/** Top-level cold-path: gather → judge → shape. Returns abstract mutations; the adapter applies them. */
export async function themes({ backlog, capabilities }) {
  const { orphans, leftoversMembers, existingThemes } = gatherParkingSurface(backlog);
  const { clusters, rationale } = await selectClusters({ orphans, leftoversMembers, existingThemes, capabilities });
  return { ...shapeThemeMutations({ clusters }), clusters, rationale };
}
