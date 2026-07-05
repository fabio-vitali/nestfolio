---
id: runtime-item-schema-reconciliation
status: shipped
closed: 2026-07-05
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "Reconcile runtime/engine/schema/item.schema.ts with the real docs/backlog frontmatter (done_criteria→done_when, relax .strict/migrate legacy keys) and wire validateItem into the read path — today ItemSchema has no production importer."
references: []
out_of_scope:
  - "Migrating backlog-lint's 11 invariants into content-ring checks — that is the P4 check-migration member; this workstream reconciles only the schema + read path."
  - "The parity-oracle regression harness — separate P3 member."
  - "Re-designing ring-1 contracts beyond the reconciliation delta; the delta re-freezes into SPEC 1 §10 within this workstream, per the epic's out_of_scope."
  - "Changing docs/backlog frontmatter data to fit the schema — the schema moves to the data, never the data to the schema (docs/backlog stays the one item store)."
  - "Forward-edge intake/planner behavior changes beyond field-name alignment."
spec: null
plan: docs/superpowers/plans/2026-07-05-runtime-item-schema-reconciliation.md
topic_memory: [project_runtime_realization.md]
validation_gate: |
  Code: ac733952 (ItemSchema reconciled: done_when identity, nullable rank, passthrough), aed765d1
  (intake/worker aligned), 45e6d693 (readItems validates fail-closed), 1b70c9ac (references union),
  1de7a6d5 (real-store sweep test), 5d325055 (SPEC 1 §10 re-freeze), 8aaf9257 (mint item-store-valid).
  Tests: node --test runtime/{engine,adapters/*,eval}/test → 187/187 pass; pnpm nx run-many -t test,lint
  -p runtime → true exit 0 (set -o pipefail, 285 assertions). Sweep: item-store-binding.test.mjs — all
  421 real docs/backlog files validate through readItems (surfaced + repaired 1 real YAML corruption,
  13ca4b2b). No deploy: detect-deploy-needed exit 10 (all Tier 0). Backward edge: ship-recheck
  gate-clean journaled; mint item-store-valid RATIFIED (journal mint:item-store-valid:g1:ratify);
  consider recorded (sha 297895b0); registration commit passed the live gate running the new check.
---

# Reconcile the runtime item schema with docs/backlog

> **Promoted 2026-07-05** (parking → queued, user-approved): the probes-first roadmap places this member
> in P3; its implicit trigger ("after P2 moat") fired when `runtime-redteam-hardening` shipped via PR #31
> on 2026-07-05 — P2 is complete, P3 (parity oracle + item schema) is the current phase.

`runtime/engine/schema/item.schema.ts` is an idealized abstract contract not wired to the real store:
- It **requires `done_criteria`** — 0 of 402 backlog files have it; 53 use `done_when`.
- It is `.strict()` — rejects the legacy `spec`/`plan`/`topic_memory`/`validation_gate`/`closed`/`notes` keys
  every backlog file carries.
- It has **no production importer** — the engine reads `docs/backlog` frontmatter raw via
  `scope-gate.mjs readItems()`; `plan-next.mjs` operates on an injected array. Neither validates.

Reconcile: rename `done_criteria`→`done_when` (or map), relax/extend the schema for the real keys, then wire
`validateItem` into the read path (scope-gate's `readItems`) so `docs/backlog` IS a validated runtime item
store. This is what lets the forward edge (intake/planner) trust its inputs.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-05
- **Decision:** Named --auto target runtime-item-schema-reconciliation was status: parking (member of parking theme epic runtime-operationalization) — Step-1 dispatch refuses parking items; how to proceed
- **Options:** Promote to queued (rank 4) and proceed standalone | Abort and run /backlog-next-epic runtime-operationalization | Stop, leave in parking
- **Chosen:** Promote to queued (rank 4) and proceed standalone — USER-APPROVED via AskUserQuestion (not auto-resolved)
- **Rationale:** The implicit trigger fired: P2 moat completed with runtime-redteam-hardening PR #31 (2026-07-05); P3 = parity oracle + item schema is the current phase. The epic is explicitly designed for standalone member drain (each member its own /backlog-next PR, as make-it-fire, backward-edge-live, redteam-hardening were).
- **Rejected:** Epic orchestrator would promote the whole theme epic to active and bind all remaining core members to one branch/PR — heavier than the established one-member-one-PR drain pattern. Stopping would leave a fired-trigger item parked.

### D2 — 2026-07-05
- **Decision:** Reconcile the closure-predicate field: rename ring-1 done_criteria to done_when (identity with the store key) vs keep the abstract name and add a field-mapping layer at the seam
- **Options:** Rename to done_when (identity binding) | Keep done_criteria + inject a fieldMap into readItems
- **Chosen:** Rename to done_when (identity binding)
- **Rationale:** Most reusable pattern: the item store frontmatter keys ARE the ring-1 contract — zero mapping machinery for an adopting project, and the SPEC 1 binding-table row becomes identity. The mapping alternative breeds exactly the drift already visible in worker.mjs (done_when ?? done_criteria). Blast-radius gate: exit 0 for ItemSchema.
- **Rejected:** A seam fieldMap preserves an abstract name nobody consumes, adds an injection point every adapter must thread, and keeps two names alive for one concept.

### D3 — 2026-07-05
- **Decision:** Unknown-key policy for ItemSchema: .strict() with enumerated project keys vs default strip vs .passthrough()
- **Options:** .passthrough() | .strict() + enumerate project keys in ring-1 | default .strip()
- **Chosen:** .passthrough() (plus rank nullish, done_when optional per the 419-file census)
- **Rationale:** Ring-1 validates the fields it owns and PRESERVES project-local extensions (spec/plan/notes/closed/validation_gate/…) — any adopting project can extend frontmatter without touching ring-1. Census-grounded: 53 files carry rank: null; only 52/419 have done_when, so requiredness stays a project lint rule (4b).
- **Rejected:** .strict()+enumeration leaks project keys into the agnostic ring; .strip() silently DROPS extension data from validated values (violates no-silent-fallback) — consumers read notes/validation_gate off readItems results.

### D4 — 2026-07-05
- **Decision:** Failure semantics when readItems hits an invalid item file
- **Options:** Fail closed: throw an aggregate error naming every invalid file | Skip invalid files and return the rest | Return {items, findings} and let callers decide
- **Chosen:** Fail closed: throw an aggregate error naming every invalid file
- **Rationale:** Matches the fail-closed registry precedent (runtime-redteam-hardening item: gate registry errors fail closed). A validated item store that silently drops members is worse than none. All 419 real files pass today (verified by census + Task 4 sweep test), so fail-closed breaks nothing. Blast-radius gate: exit 0 for readItems.
- **Rejected:** Skipping = silent data loss (no-silent-fallback feedback). A result-shape change would ripple the signature through scope-gate CLI x2 + run-item for no consumer that wants partial reads.

### D5 — 2026-07-05
- **Decision:** Plan execution mode: subagent-driven vs inline executing-plans
- **Options:** Inline via superpowers:executing-plans | Subagent-driven development
- **Chosen:** Inline via superpowers:executing-plans
- **Rationale:** Standing user feedback (no-worker-isolating-subagents): do not strip AskUserQuestion/visibility via isolated workers — the epic Tier-2 isolation was explicitly reverted to inline. 5 small sequential tasks over shared files gain nothing from per-task subagents.
- **Rejected:** Subagent-driven adds per-task context re-derivation and hides floor surfaces from the user.

### D6 — 2026-07-05
- **Decision:** Task-4 sweep surfaced 1 file whose out_of_scope entry is a YAML authoring bug (unquoted scalar with embedded colon parsed as a one-key mapping) — repair the data or tolerate objects in the schema, given the workstream out_of_scope forbids changing store data to fit the schema
- **Options:** Repair the corrupt scalar (quote it) — data BUG fix, not reshaping | Extend the schema to tolerate object out_of_scope entries | Park the file and exclude it from the sweep
- **Chosen:** Repair the corrupt scalar (quote it)
- **Rationale:** The out_of_scope guard forbids reshaping store conventions to fit the schema; it does not protect a YAML typo that corrupts a value against its own intended type (prose string). Intent is unambiguous. Tolerating accidental one-key mappings would enshrine corruption as contract. Blocking evidence of the feature working: the corruption ALSO silently dropped this shipped item from BACKLOG.md Recently Shipped — repaired index regenerates correctly.
- **Rejected:** Schema tolerance makes every future typo schema-legal; excluding the file breaks the docs-backlog-IS-the-store acceptance criterion.

### D7 — 2026-07-05
- **Decision:** 6.4b mint consideration: did this ship surface a mechanizable, recurring, still-intended lesson?
- **Options:** Mint item-store-valid commit-gate check | Nothing mechanizable (consider --none)
- **Chosen:** Mint item-store-valid — USER-APPROVED via AskUserQuestion, then candidate RATIFIED by human at the mint floor (journal key mint:item-store-valid:g1:ratify)
- **Rationale:** Real gap proven in-workstream: element-shape store corruption passes backlog-lint and the sweep test only runs when the runtime project is nx-affected — nothing validated the store at commit time. The minted check (deterministic zero-arg core, gate+invariant contexts, docs/backlog/*.md scope) closes it; golden-gate scenario landed with the real corruption class as the bad fixture. Verified: real store 0 violations, good 0, bad 1; the registration commit itself passed the live gate running the new check.
- **Rejected:** consider --none would leave the commit-time gap open until the P4 check-migration member.

### D8 — 2026-07-05
- **Decision:** Step 6.7 finishing menu: merge locally vs push+PR vs keep vs discard
- **Options:** Merge back to main locally | Push and create a Pull Request | Keep the branch as-is | Discard
- **Chosen:** Push and create a Pull Request (--auto policy 2: PR route, then STOP at the open PR)
- **Rationale:** --auto NEVER merges (merge ownership is the user's — epic E8 / LESSONS F-7/F-33). PR route matches the epic's established one-member-one-PR drain pattern (PR #30, #31).
- **Rejected:** Local merge is forbidden in --auto; keep/discard would abandon a shipped workstream.
