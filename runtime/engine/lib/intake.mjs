// runtime/engine/lib/intake.mjs — turn a Finding into 0/1/many Items via the epic-aware router (§7).
// selectRoute = JUDGMENT (seamed via capabilities.execute — the same judgment the eval corpus grades);
// shapeItems = a PURE deterministic core. Ring-1 produces abstract Item[]; the frontmatter write is the
// project binding. Every item carries provenance.from_finding — the forward-edge trace link (§10).
import { AGENT_OBSERVED } from '../schema/finding.schema.ts';
import { loadIntakeContext, renderIntakePrompt } from './intake-context.mjs';
// A finding with no real originating check (omitted, or the reserved AGENT_OBSERVED sentinel) is an
// agent-observed side-finding: slug from its unique finding.id, and omit from_check from provenance.
const originatingCheck = (finding) => (finding.check && finding.check !== AGENT_OBSERVED ? finding.check : null);
const slug = (finding, suffix) => `from-${originatingCheck(finding) ?? finding.id}${suffix ? `-${suffix}` : ''}`;
const baseItem = (finding, over) => {
  const check = originatingCheck(finding);
  return {
    id: over.id ?? slug(finding),
    type: 'bug',
    status: 'parking',
    done_when: `resolve: ${finding.detail}`,
    provenance: { from_finding: finding.id, ...(check ? { from_check: check } : {}) },
    ...over,
  };
};

export function shapeItems({ finding, route, epic, epicRole, splitInto }) {
  switch (route) {
    case 'discard': return [];
    case 'split':   return (splitInto ?? []).map((s) => baseItem(finding, { id: slug(finding, s) }));
    // Every epic-attaching route writes epic_role route-agnostically — the item shape is identical (an
    // epic pointer + a role); the routes differ only in WHICH epic (selectRoute's judgment), never in the
    // written shape. Anything but 'core'/'captured' from the judge is undefined here → defaults to 'core',
    // matching the CLAUDE.md epic_role default (so a member never silently lands core by an omitted key).
    case 'fold':
    case 'join-theme':
    case 'mint-aggregation':
      return [baseItem(finding, { epic, epic_role: epicRole ?? 'core' })];
    case 'orphan':  return [baseItem(finding, {})];
    default: throw new Error(`unknown intake route: ${route}`);
  }
}

export async function selectRoute({ finding, backlog, capabilities }) {
  const context = loadIntakeContext({ backlog });
  const task = { id: `intake-${finding.id}`, scope: finding.scope,
    prompt: renderIntakePrompt({ finding, context }),
    payload: { finding, backlog, context } };
  const result = await capabilities.execute(task);
  const d = JSON.parse(result.summary);   // seam convention: route decision as JSON in summary
  return { route: d.route, epic: d.epic, epicRole: d.epicRole, splitInto: d.splitInto, rationale: d.rationale ?? result.summary };
}

export async function intake({ finding, registry, backlog, capabilities }) {
  const d = await selectRoute({ finding, backlog, capabilities });
  return { finding, route: d.route, items: shapeItems({ finding, ...d }), epic: d.epic, rationale: d.rationale };
}
