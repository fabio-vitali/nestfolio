---
id: benchmark-agents-skill-simplification
status: parking
type: refactor
notes: "benchmark-agents SKILL.md (§5/§6) prescribes report templates inline; relocate to run.ts+templates."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
# epic: <epic-id>          # orphan — see routing note below; no scoped epic fits
# epic_role: core|captured
---

# benchmark-agents skill simplification

`.claude/skills/benchmark-agents/SKILL.md` is 187 lines, and a large fraction is **report-format
prescription baked into skill prose**:

- §5 "Per-task evaluation.md" (≈ lines 101–122) — the full section ordering, the comparison-table
  column list, the per-model paragraph structure, the recommendation sentence template.
- §6 "Cross-task report" (≈ lines 123–148) — the snapshot-table columns, the side-by-side quality
  matrix block format, the cost-delta formula, the action-item shape.

This procedural/template detail is what the skill tells *Claude* to hand-author each run. It could
move into `scripts/benchmark-agents/run.ts` (or a `report.ts` / markdown template the runner emits
from `raw-results.json`), leaving `SKILL.md` as a thin orchestrator: argv-parse against the live task
allowlist (§0), preflight + cache refresh (§1–3), the sequential sweep loop (§4), the PII guard (§7),
and the `AskUserQuestion` apply gate (§9). Deterministic report shape belongs in code; the skill prose
should keep only the judgment the LLM actually adds (semantic-quality commentary, the three-gate
verdict, the final recommendation reasoning).

**Cheapest next step:** extract the §5/§6 markdown structure into a `report.ts` the runner calls, then
verify the produced `evaluation.md` / `cross-task-report.md` are equivalent to the current hand-authored
shape on a captured `raw-results.json` fixture (no behavior/metric change — pure relocation).

**Routing note (orphan, deliberate):** this is the **same debt class** as the
`backlog-skills-simplification` epic (heavy SKILL.md prose → thin router + tested helpers / templates),
but that epic's `scope:` is bounded to the backlog skill suite (`backlog-next/-next-epic/-add/-themes/-lint`)
and its `done_when` is "no backlog behavior or lint invariant changed" — `benchmark-agents` is a
different skill family, so folding it in would be scope-creep. Filed as a plain parking orphan. A future
`/backlog-themes` sweep could mint a generalized "SKILL.md-prose → thin-router" theme epic that
aggregates this with the `backlog-skills-simplification` debt class if cross-skill consolidation is wanted.

Surfaced while assessing whether the `claude-api` skill could improve `benchmark-agents` — conclusion:
no, they are parallel model-facts layers across the Bedrock / first-party provider boundary
(`benchmark-agents` discovers Bedrock models + AWS Pricing API prices live and multi-vendor;
`claude-api` is a static Claude-only first-party catalog), not composable. This item is purely the
skill-simplification refactor, independent of that conclusion.
