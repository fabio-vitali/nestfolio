---
id: runtime-replatform-lint
status: shipped
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "P5 WS-2 (spec §8): re-platform backlog-lint onto the registry gates. This wires the flag so preflight/postflight call `run-watch --on=commit --changed='docs/backlog/*.md'` behind RUNTIME_ENGINE (D3, user-confirmed 2026-07-07 — the earlier --on=manual (D2) was rejected after measurement: it pulls in 5 audit judge checks + the pre-existing typed-subjects drift), and closes the parity-oracle lint-differential gap; the lint gate does NOT journal path:runtime (it is a validation gate, not a workstream driver — see plan's open point); renderIndex/syncDossiers stay the untouched --fix side-car. VERIFIED 2026-07-07 against running code: rule-3 (backlog-references-valid) is ALREADY a complete module: check (differential class=both-catch), and the 11 rules are already migrated via P4 check-migration — the spec's 'add the rule-3 evaluator / the one rule with no scheme' premise is STALE. The real oracle work is mechanical: seed the 4 already-migrated content checks (r4 active-out-of-scope, r5 shipped-validation-gate, r6 queued-ranks, r8 promotion-trigger-gated) into scripts/parity-oracle/store-sandbox.mjs SEED_CHECKS and flip their RULE_MAP rows to mapped:true (they turn both-catch). Promoted 2026-07-07 (standalone member per epic D1): the block trigger fired — runtime-replatform-prereqs shipped 2026-07-06 (RUNTIME_ENGINE flag + path-provenance, soak-observer.mjs, the parity-oracle extension mechanism, and the 3 parity-hole fixes), verified status: shipped / closed: 2026-07-06. Sibling WS-1 (runtime-replatform-add) promoted+shipped the same way 2026-07-07."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
out_of_scope:
  - "The flag/observer/parity-hole mechanism — that is runtime-replatform-prereqs."
  - "renderIndex / syncDossiers doc-store materialization — stays a side-car by design (spec §2)."
  - "Deleting the legacy lint.mjs rule bodies (P6, user-triggered)."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: docs/superpowers/plans/2026-07-07-runtime-replatform-lint.md
topic_memory: [project_runtime_realization.md]
validation_gate: "WS-2 re-platform of backlog-lint onto the runtime check-registry (SDD, 4 tasks each impl+review clean; final whole-branch review on opus = Ready-to-merge:Yes). Feature commits: f66b6cd6 (backlog-gate.mjs flag-branch selector), 2da5a77e (preflight.mjs:110 + postflight.mjs:201 wired via backlogGate — flag-on → `run-watch --on=commit --changed='docs/backlog/*.md'`, flag-off → legacy lint.mjs byte-for-byte), d1f9e141 (backlog-lint SKILL.md runtime-path doc), a81d458f (parity-oracle: seed r4/r5/r6/r8 content checks into store-sandbox SEED_CHECKS + flip RULE_MAP mapped:true), 156af43f (SKILL.md scope note: gate rides all repo invariants). Rule-3 verified ALREADY complete (no net-new evaluator — spec §8 premise stale). Tests (node --test, all green): backlog-gate 3, gate-wiring 2, runtime-flag 2; full suites parity-oracle 33/33, backlog-lint 71/71, backlog-next 69/69. Parity acceptance (deterministic, no LLM sweep): `node scripts/parity-oracle/lint-differential.mjs` exit 0 — every row both-catch except element-shape (runtime-only); r4/r5/r6/r8 flipped legacy-only→both-catch. Preflight smoke: RUNTIME_ENGINE=1 and unset both exit 0. nx-affected EMPTY (only .claude/skills, scripts/parity-oracle, docs). Tier-0 (detect-deploy exit 10; detect-doc-derivation exit 10). Backward edge: ship-recheck clean (journaled ship:runtime-replatform-lint:gate-clean); mint considered=none (consider:runtime-replatform-lint). Decisions D1 (TDD-plan-then-review), D2→D3 (gate entrypoint run-watch --on=commit --changed=docs/backlog/*.md, supersedes --on=manual) in the Decision log. Deferred follow-up (soak-gate member): realign lint-differential runtimeExit --on=manual → --on=commit to grade the literal production command (low-risk — r4/r5/r6/r8 are invariants that ride every trigger)."
closed: 2026-07-07
---

# WS-2 — re-platform `backlog-lint` onto registry gates

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §8 (WS-2).
The rule atoms are already checks; this member wires `preflight`/`postflight` through `run-watch --on=manual`
behind `RUNTIME_ENGINE`, journals `path:runtime` for the soak-observer, and seeds the four already-migrated
r4/r5/r6/r8 content checks into the parity differential (flipping their `RULE_MAP` rows to `mapped:true`).
Index/dossier regen stays a side-car.

> **Verified 2026-07-07 (measure-before-proposing):** running `node scripts/parity-oracle/lint-differential.mjs`
> shows rule-3 (`backlog-references-valid`) already `both-catch` — a complete `module:` check with full anchor
> resolution. **No net-new rule-3 evaluator** (the spec §8 / original notes premise was stale — P4 check-migration
> already delivered it). The genuine gap is r4/r5/r6/r8 = `legacy-only`, because `store-sandbox.mjs` `SEED_CHECKS`
> never seeded those four existing checks. Gate entrypoint = `run-watch --on=manual` (matches the parity-graded
> path) and routing = TDD-plan-then-review, both user-confirmed 2026-07-07 (see Decision log).

**Unblocked 2026-07-07:** `runtime-replatform-prereqs` shipped 2026-07-06 — it landed the
`RUNTIME_ENGINE` flag + path-provenance journal, `scripts/parity-oracle/soak-observer.mjs`, the
parity-oracle extension mechanism (the 42 `unmapped:'P5'` scenarios + `path:runtime` grade
assertion), and the 3 parity-hole fixes. Promoted to the active workstream as a standalone member
PR (epic decision D1), mirroring how sibling WS-1 (`runtime-replatform-add`) was promoted+shipped
2026-07-07.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-07
- **Decision:** Routing for WS-2 (runtime-replatform-lint): full brainstorm→design-doc vs straight-to-TDD-plan vs fully-autonomous execution.
- **Options:** Straight to TDD plan now, then stop for user review before execution | Brainstorm→design doc first (mirror WS-1) | Fully autonomous --auto: write plan and execute, pause only at the hard floor
- **Chosen:** Straight to TDD plan now, stop for user review before execution.
- **Rationale:** Empirical verification pinned the scope: rule-3 already done, the ring-1 architecture is frozen, and the oracle gap is a mechanical seed+flip. Strategy spec section 14 flagged WS-1/WS-3 as having unresolved plan-level forks but NOT WS-2 — a settled-design signal. No architectural fork remains, so writing-plans is the correct route and the plan review is the design checkpoint. User-confirmed via AskUserQuestion.
- **Rejected:** Brainstorm — no section-14-flagged fork to resolve; over-invests for wiring work. Fully-autonomous — the gate-wiring is pattern-setting for next/next-epic, a decision the user chose to review.

### D2 — 2026-07-07
- **Decision:** Which runtime entrypoint the RUNTIME_ENGINE flag-on path calls in preflight/postflight (pattern-setting: next/next-epic inherit it).
- **Options:** run-watch --on=manual | run-gate --item-scope=docs/backlog/*.md | Defer to planning
- **Chosen:** run-watch --on=manual
- **Rationale:** The deterministic lint-differential already grades run-watch --on=manual, so the parity-graded path equals the production path with no oracle realignment. It runs all cheap invariant+gate backlog checks whole-store with no item arg. Enforcing all invariants (broader than legacy backlog-only lint.mjs) is the intended runtime behavior. User-confirmed via AskUserQuestion.
- **Rejected:** run-gate — would force realigning the differential to grade run-gate to keep graded==production. Defer — the decision was ready to make now.

### D3 — 2026-07-07
- **Decision:** Gate entrypoint scope for the RUNTIME_ENGINE flag-on backlog gate (SUPERSEDES D2).
- **Options:** run-watch --on=commit --changed=docs/backlog/*.md (backlog-scoped) | Strict backlog-only finding filter | Whole-repo --on=commit (no scope)
- **Chosen:** run-watch --on=commit --changed='docs/backlog/*.md'
- **Rationale:** SUPERSEDES D2 (run-watch --on=manual). Measurement against the REAL registry invalidated D2: --on=manual selects 5 audit skill: judgment checks that fail-closed without an injected LLM judge, and surfaces a pre-existing non-backlog typed-subjects drift — both would fail preflight spuriously. The runtime gate rides ALL invariants, not just the 11 backlog rules. Measured: run-watch --on=commit --changed='docs/backlog/*.md' exits CLEAN on the valid backlog — the commit trigger has no audit context (no judge needed), and typed-subjects is contexts:[gate] NOT invariant, so the backlog scope excludes it. Deterministic, minimal (command swap), consistent with the differential's backlog-check parity. User-confirmed via AskUserQuestion 2026-07-07.
- **Rejected:** Strict backlog-only finding-filter — stricter parity but needs a filter wrapper; unnecessary since the scoped commit trigger is already clean. Whole-repo --on=commit — blocked today by the pre-existing typed-subjects drift, which is outside WS-2 scope.
