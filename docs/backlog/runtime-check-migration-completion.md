---
id: runtime-check-migration-completion
status: active
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "DETERMINISTIC TIER (scoped 2026-07-06): migrate the §12 DETERMINISTIC surfaces into runtime/content/checks CheckEntry YAML, all riding the live commit gate: 3 cmd: checks (check-no-appsync-literals/-typed-fixtures/-typed-subjects), a gate-free service-structure cmd: check (verify-structure.sh #1-7 extracted to avoid gate recursion), and ALL remaining deterministic backlog-lint rules as module: core-wrappers delegating to rules.mjs (precondition + 2,3,4,4a,5,6,7,8,9,10,11; rule 1 already done). ACCEPTANCE: 'migrated' = the check RUNS on the commit cadence, demonstrated not asserted. The JUDGMENT tier (audit-* skills, captured-audit, 2 judgment gaps, live judge binding, expensive-cadence dispatcher, >=1 real audit) split to runtime-check-migration-judgment-tier; exclusions relocation split to runtime-check-exclusions-content-ring. Prereqs shipped (runtime-backward-edge-live 2026-07-04, runtime-regression-harness 2026-07-06). Promoted + split 2026-07-06."
references: []
out_of_scope:
  - "The JUDGMENT tier — 4 audit-* skills, backlog-lint captured-audit, the 2 judgment gaps, the live judge binding, the expensive-check cadence dispatcher, and >=1 real audit execution — split to new epic core member runtime-check-migration-judgment-tier (2026-07-06)."
  - "Exclusions relocation — moving 8 tools/*-exclusions.json under runtime/content/exclusions/ + wiring exclusionsRoot — split to new epic core member runtime-check-exclusions-content-ring (2026-07-06)."
  - "Legacy retirement — removing migrated checks from .git/hooks/pre-commit or scripts/verify-structure.sh — is P6 (user-triggered); this workstream keeps legacy running alongside (belt-and-suspenders double-coverage)."
  - "CI wiring of the check golden gates (tools/check-*.test.mjs fixtures) — owned by the sibling epic member runtime-check-goldengates-ci, not this workstream."
  - "The 2 detect-*.mjs frontmatter parsers (detect-deploy-needed / detect-doc-derivation) — homed in the deploy-tooling-integrity epic per lint-library-total-and-located's out_of_scope; not migrated here."
  - "Authoring NET-NEW checks beyond migrating existing enforcement (epic out_of_scope) — new lessons flow through the backward edge / backlog-add."
  - "The work-driver strangler re-platform (runtime-work-driver-replatform) and the operator surface (runtime-operational-surface) — later epic members (P5/P6)."
  - "Re-designing ring-1 engine contracts (CheckEntry schema/helpers) — frozen by runtime-realization; a build-reconciliation delta re-freezes into SPEC 1, not here."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Finish the check migration — deterministic tier (the §12 no-lost-value map)

The full P4 migration was split into two tiers on 2026-07-06 (see Decision log). THIS workstream is the
**deterministic tier**: migrate the §12 deterministic surfaces into `runtime/content/checks/` so each one
**runs on the live commit gate** (the only wired cadence; `module:`/`cmd:` checks are `cheap`/`gate`/
`invariant`, so no new dispatcher is needed). Design spec:
`docs/superpowers/specs/2026-07-06-runtime-check-migration-completion-design.md`.

**In scope — three proven patterns:**
- **3 `cmd:` checks** → mirror `no-ddb-scan.yaml`: `check-no-appsync-literals`, `check-typed-fixtures`,
  `check-typed-subjects`. (`check-typed-subjects` carries `scope.exclusions: tools/typed-subject-exclusions.json`
  for now — the deferred exclusions item relocates it.)
- **`service-structure` `cmd:` check** — extract `verify-structure.sh` checks **#1-#7** into a gate-free
  `scripts/check-service-structure.sh` and bind `cmd:` to it. (A raw `cmd:scripts/verify-structure.sh` would
  recurse: that script itself invokes the runtime gate at line 18.) Legacy `verify-structure.sh` keeps running
  #1-#10 (belt-and-suspenders until P6 retirement).
- **Backlog-lint deterministic rules → `module:` core-wrappers** — mirror `backlog-id-core.mjs` (rule 1): a
  zero-arg export that **imports `rules.mjs` + `loadBacklogFiles`** (delegate, never fork — single-parser
  discipline per [[lint-library-total-and-located]]), runs the rule over all backlog files, maps to findings.
  One `runtime/content/lib/backlog-rules-core.mjs` with an arity adapter + one named export per rule, one
  CheckEntry each. Migrate **all remaining deterministic rules** for a complete map: precondition + 2, 3, 4,
  4a-epic, 5, 6, 7, 8, 9, 10, 11 (rule 1 already done).

**Acceptance:** each new check **runs on the commit cadence — demonstrated, not asserted** (stage a violating
fixture → the pre-commit gate blocks; clean → it passes); `registry-integrity` (`meta-check.mjs`) green;
`rules.mjs` + tool `*.test.mjs` suites green; nx `test,lint` on affected green.

**Split out (both remain core members of the epic, so `done_when` stays complete):** the **judgment tier**
(4 audit-* skills, captured-audit, the 2 judgment gaps, the live judge binding, an expensive-cadence
dispatcher, ≥1 real audit) → `runtime-check-migration-judgment-tier`; the **exclusions relocation** →
`runtime-check-exclusions-content-ring`.

**Sequencing (satisfied 2026-07-06):** the binding prerequisite `runtime-backward-edge-live` shipped
2026-07-04 (curate-at-the-floor exists, so enforcement scale can grow without `RUNTIME_GATE_SKIP` becoming
de-facto curation — drift design law 5). The P3 parity oracle `runtime-regression-harness` shipped 2026-07-06
(go/no-go GREEN). Both triggers fired; the item was promoted from parking on 2026-07-06.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-06
- **Decision:** Promote runtime-check-migration-completion from parking and start it as the P4 workstream
- **Options:** Promote & proceed | Hold — keep parked
- **Chosen:** Promote & proceed
- **Rationale:** Both binding sequencing triggers fired: runtime-backward-edge-live shipped 2026-07-04 (curate-at-the-floor exists, so enforcement scale can grow without RUNTIME_GATE_SKIP becoming de-facto curation) and the P3 parity oracle runtime-regression-harness shipped 2026-07-06 (go/no-go GREEN). User confirmed via AskUserQuestion. Adoption done in-worktree (parking→active) to avoid a transient queued+rank state and a main push.
- **Rejected:** Hold — keep parked: no reason to defer; P4 is next in the roadmap and all prerequisites are shipped.

### D2 — 2026-07-06
- **Decision:** Split P4 check migration into a deterministic tier (this workstream) and a judgment tier (new epic member)
- **Options:** Split: deterministic now, judgment new item | One workstream: full P4 in a single PR
- **Chosen:** Split: deterministic now, judgment new item
- **Rationale:** The item bundled proven-pattern cmd:/module: migrations with a net-new judgment subsystem: the skill: judge executor is an unbound stub (throws JudgeCapabilityUnavailable; makeRunProcedure procedures map is never populated) and no expensive-check cadence dispatcher exists (only commit is wired). Atomicity (one closure verdict per tier) + reusability (two cleanly-liftable patterns: legacy-check to CheckEntry, and Skill to judgment-adapter) + epic D1 'split oversized items'. Judgment tier filed as runtime-check-migration-judgment-tier (core member) so the epic done_when stays complete. User chose via AskUserQuestion.
- **Rejected:** One-workstream full P4: a large mixed-risk PR where trivial cmd: entries cannot close until the novel judge infra (adapter + cadence dispatcher + a real audit execution) works.

### D3 — 2026-07-06
- **Decision:** Defer the exclusions relocation to its own epic member
- **Options:** Defer to its own epic item | Include - relocate only | Include - full engine wiring
- **Chosen:** Defer to its own epic item
- **Rationale:** Exclusions relocation is an item body-bullet, NOT a SPEC section-12 migration surface, and touches ~15 consumer references (tool hardcoded paths, scope.exclusions fields, lessons.mjs, nx inputs, tests) plus potentially a ring-1 contract change. The migrated checks already run correctly with their tools/ sidecars, so exclusion location is orthogonal to 'runs on a cadence'. Filed as runtime-check-exclusions-content-ring (core member); the relocate-only vs engine-owned mechanism is that item's own design call. User chose via AskUserQuestion.
- **Rejected:** Include-relocate-only / include-full-wiring: bundles a ~15-reference sweep (and possibly a ring-1 contract change) onto a mechanical-migration PR, diluting the atomic 'checks migrated' verdict.

### D4 — 2026-07-06
- **Decision:** Migrate ALL remaining deterministic backlog-lint rules (incl. 2, 3, 7), not just the item's listed subset
- **Options:** All remaining deterministic rules (precondition + 2,3,4,4a,5,6,7,8,9,10,11) | Item's listed subset only (4,5,6,8,9,10,11 + precondition)
- **Chosen:** All remaining deterministic rules (precondition + 2,3,4,4a,5,6,7,8,9,10,11)
- **Rationale:** The workstream's done-definition is 'complete the section-12 no-lost-value map'. The item body listed 4,5,6,8,9,10,11 + precondition but omitted the still-unmigrated deterministic rules 2 (single-active), 3 (references-valid), and 7 (index-matches); leaving them would make the map incomplete for backlog-lint. All are pure exported rules.mjs functions wrappable as zero-arg module: cores. User approved at design sign-off.
- **Rejected:** Item's listed subset only: leaves rules 2/3/7 unmigrated, so the section-12 map stays incomplete for backlog-lint.
