// draft-candidate.mjs — draftCandidate(): §4 step 2. The worker reduces a lesson to a single
// consistency property; this helper enforces the §8 three-gate test (fail any ⇒ null = retrieval-only),
// assembles the candidate CheckEntry (status candidate, provenance.minted_by + lesson, NO ratified — Δ2),
// wraps it, and validates. Deterministic-first (§8.2): a judgment proposal carries flake_contract.
import { validateCandidateDraft } from '../schema/candidate-draft.ts';
import { fileURLToPath } from 'node:url';

const lessonRef = (lesson) => (typeof lesson === 'string' ? lesson : (lesson.path ?? lesson.id ?? lesson.name));

export function draftCandidate({ item, lesson, proposal }) {
  const g = proposal?.gates ?? {};
  if (!(g.mechanizable === true && g.recurring === true && g.stillIntended === true)) return null;   // §8 gate

  const entry = {
    id: proposal.id,
    property: proposal.property,
    kind: proposal.kind,
    evaluator: proposal.evaluator,
    cost_tier: proposal.cost_tier ?? 'cheap',
    contexts: proposal.contexts,
    scope: proposal.scope,
    status: 'candidate',
    provenance: { minted_by: item.id, lesson: lessonRef(lesson),
      ...(proposal.generation != null && proposal.generation > 1 ? { generation: proposal.generation } : {}) },   // Δ2: NO ratified; §2.4 epoch
  };
  if (proposal.flake_contract) entry.flake_contract = proposal.flake_contract;   // judgment only

  const draft = { entry, eval_scenario: proposal.eval_scenario, rationale: proposal.rationale };
  if (proposal.supersedes_candidate) draft.supersedes_candidate = proposal.supersedes_candidate;

  const r = validateCandidateDraft(draft);
  if (!r.ok) throw new Error(`draftCandidate produced an invalid draft for "${proposal.id}": ${r.error}`);
  return r.value;
}

function main() { console.error('draft-candidate.mjs is a library; import draftCandidate'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
