---
id: typed-test-fixtures-phase0
status: shipped
epic: typed-test-fixtures
epic_role: core
type: feature
requires_deploy: true
notes: "Phase 0 of the typed-test-fixtures epic: build the reusable mechanism AND retrofit compliance-ctrl's fixtures as the proof, fixing the two pre-existing co-wrong fixtures that motivated the program. Mechanism (spec §3): producer-owned event->schema maps (extend publisher-schemas to event-name level), a composed registry lib (libs/test-contracts), a generic typed putEvent({ detailType, subject: SubjectOf<K>, context? }) with a runtime parse backstop, and typed TableAssertions matchers. Proof: migrate compliance-ctrl integration + e2e fixtures to the typed API. Bug A (integration mandate fixtures put per-test userId in the subject; handler keys by ctx.userId) becomes a compile error fixed via the typed context param. Bug B (update-operating-mode e2e RECOMMENDATION_PROPOSED omits isInitialBuild/riskCategory required by RecommendationProposedSchema) becomes a missing-field compile error. If Bug B's fields are also absent from the REAL decision-workflow-ctrl emission, file that as a separate latent contract bug (spec §7 triage)."
done_when: "Mechanism shipped + unit-tested (a fixture omitting a required subject field fails to compile — pinned with @ts-expect-error; runtime parse throw-path unit-tested). compliance-ctrl integration suite GREEN against deployed dev (Bug A fixed). update-operating-mode e2e GREEN end-to-end (Bug B fixed; real-producer emission of isInitialBuild/riskCategory confirmed or the gap filed). Regression gate forbids untyped putEvent in compliance-ctrl fixtures."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
out_of_scope:
  - "Retrofitting other services' fixtures (Phases 1-4)"
  - "Production contract/producer/consumer changes (test layer only)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: docs/superpowers/plans/2026-06-16-typed-test-fixtures-phase0.md
topic_memory: [project_event_subject_contracts.md]
validation_gate: "SHIPPED 2026-06-17 (branch worktree-typed-test-fixtures-phase0, 16 commits 0c11fdd0..0b62f8f0). MECHANISM: libs/test-contracts registry (EventSubjects/RegisteredEventName/SubjectOf) + producer maps (mandateEventSubjects, decisionWorkflowEventSubjects); test-support putEvent typed overload + runtime parse backstop (put-event-backstop.test.ts 2/2) + @ts-expect-error type-tests (test-support:typecheck green, 4 negative guards fire); integration-testing waitForItem<T>; tools/check-typed-fixtures.mjs gate wired into verify-structure.sh Check 9 (self-test proves it fails on legacy detail:). SHARED-INFRA (user-approved): @nestfolio/* Jest resolution centralized in jest.preset.js (pathsToModuleNameMapper, absolute prefix, 368c84be) — nx run-many -t test 47/48, affected test+lint exit 0 (only known agent-orchestrator @smithy worktree-symlink false-FAIL). BUG A FIXED+VALIDATED: compliance-ctrl integration GREEN vs deployed dev 15/15, 2 suites (bccaa10c+a66ab5b1). BUG B parseSubject ZodError FIXED (7d003f17): update-operating-mode e2e now PRODUCES a ComplianceCheck (no timeout); real producer emits isInitialBuild+riskCategory (decision-state-machine.ts L226-227 — no producer gap). DONE-DEFINITION CAVEAT: the e2e's deeper L1 assertion is NOT green — blocked by a SEPARATE co-wrong onboarding fixture (mandateLevel stripped by OnboardingCompletedRecordSchema → e2e tenants forced level=ADVISORY → L2), filed as onboarding-mandatelevel-contract-gap (queued rank 1, epic core member) per the epic's test-layer-only out_of_scope; shipped with that blocker filed per user direction. NO DEPLOY: only inert test-fixture registry exports + test infra changed; gates ran against existing deployed dev. CIRCULAR-DEP FIX: post-merge fresh lint on main caught a TEST-ONLY circular dependency (test-support->test-contracts->producer->test-support; production graph acyclic) that nx CACHE had masked in the worktree — resolved with ignoredCircularDependencies [['test-contracts','*']] in eslint.config.js (spec §5 compatibility claim corrected); full cache-off lint sweep 50 projects clean."
---

# Phase 0 — mechanism + compliance-ctrl retrofit (fixes Bug A + Bug B)

Builds the reusable typed-fixture mechanism (spec §3) and proves it by retrofitting compliance-ctrl's
integration + e2e fixtures, which turns the two motivating pre-existing co-wrong fixtures into
compile-then-corrected errors:

- **Bug A** — compliance-ctrl integration mandate fixtures place a per-test `userId` in the event
  subject and poll by it, but the handler keys `MandateSnapshot` by `ctx.userId` (DRY identity). Fixed
  by the typed `context` param (per-test identity in context; subject typed DRY so identity-in-subject
  is an excess-property error). Suite has been red since `c043f043`.
- **Bug B** — `update-operating-mode` e2e's synthetic `RECOMMENDATION_PROPOSED` omits `isInitialBuild`
  + `riskCategory`, required by `RecommendationProposedSchema` since WS-3 `6ea8b86b` → `parseSubject`
  throws. Fixed by typing the subject (missing-field compile error). **Verify** whether the real
  decision-workflow-ctrl emission carries those fields; if not, file the real producer-contract bug.

Validated by: the mechanism's type-tests + the compliance-ctrl integration suite and the
update-operating-mode e2e going green against deployed dev.

## Phase 0 ship (2026-06-17)

**Delivered — the reusable typed-fixture mechanism (spec §3):**
- `libs/test-contracts` composes producer event→schema maps into a typed `EventSubjects` registry
  (`RegisteredEventName` / `SubjectOf<K>`); producers export the maps (`mandateEventSubjects` in
  investor-adpt/domain, `decisionWorkflowEventSubjects` in decision-workflow-ctrl/contracts).
- `test-support` `EventBridgeClient.putEvent` gained a typed overload (`detailType: K`,
  `subject: SubjectOf<K>`, `context?: TestEventContext`) beside the **retained** legacy `detail:`
  overload (so the ~280 unmigrated call-sites still compile), with a runtime `schema.parse()` backstop.
  Compile-error type-tests (`@ts-expect-error`) pinned via `test-support:typecheck`.
- `integration-testing` `waitForItem<T>` made generic (backward-compatible default).
- Regression gate `tools/check-typed-fixtures.mjs` forbids legacy `detail:` / `.subject as` in migrated
  dirs (Phase 0: compliance-ctrl/test), wired into `verify-structure.sh` Check 9.
- **Shared-infra bonus (user-approved architectural decision):** `@nestfolio/*` Jest resolution
  centralized in `jest.preset.js` via `pathsToModuleNameMapper` (absolute prefix) — unblocked
  `test-contracts` in every consumer and ended the per-project `moduleNameMapper` sprawl for the
  remaining phases.

**Bug triage (spec §7 — count + (a)/(b) split, no silent truncation):**
- **Bug A** (compliance-ctrl integration + resilience mandate fixtures: per-test `userId` in subject) —
  **case (a) fixture-only**. Migrated identity to `context`; subject typed DRY. Validated:
  compliance-ctrl integration GREEN vs deployed dev (15/15).
- **Bug B** (update-operating-mode e2e RECOMMENDATION_PROPOSED omits isInitialBuild/riskCategory) —
  **case (a) fixture-only**. Real producer emits both (decision-state-machine.ts L226-227) → **no
  producer gap to file**. Fixed; the e2e now produces a `ComplianceCheck` instead of timing out.
- **Discovered during validation (case a, OUT of Phase-0 scope)** — the e2e's *deeper* L1 assertion is
  blocked by a **separate** co-wrong onboarding fixture: `mandateLevel` is stripped by
  `OnboardingCompletedRecordSchema`, so every `e2e-` tenant is forced to `level=ADVISORY` and
  compliance returns L2 regardless of operatingMode (deployed-dev evidence: ComplianceCheck
  `mandateSnapshot.level=ADVISORY`, `operatingMode=AGGRESSIVE`, `violations=[]`). Filed as
  **`onboarding-mandatelevel-contract-gap`** (queued rank 1, epic `core` member). Proper fix is a
  production schema+transform change — deferred per the epic's test-layer-only `out_of_scope`; it is
  exactly what typing the onboarding fixture in **Phase 1 (Investor)** will surface as a compile error.

**Done-definition note:** mechanism + Bug A (green) + Bug B (parseSubject fixed, ComplianceCheck now
produced) delivered. The `done_when` "update-operating-mode e2e GREEN end-to-end" is **not** met — the
residual L1 assertion is blocked by the filed onboarding finding, not by Bug B. Shipped with that
blocker filed+queued per user direction (the e2e-green clause was predicated on Bug B being the only
blocker; a second, independent, out-of-scope blocker was discovered and filed).

**No deploy:** the only production-src changes are behaviorally-inert test-fixture registry exports
(investor-adpt, decision-workflow-ctrl); everything else is test infra. Both validation gates ran
against existing deployed dev.

**Circular-dependency discovery (caught post-merge, fresh lint on main):** the registry approach makes
`test-contracts` (a lib that `test-support` depends on) import producer-service `/contracts`. Because
those producer services' *tests* import `test-support`, and producers reference each other
(`decision-workflow-ctrl` reads `compliance-ctrl`'s ComplianceCheck back via `sfn-callback.ts`), nx's
project graph sees a cycle. It is **test-only** — `test-support`/`test-contracts` are never bundled into
any Lambda, so the production graph is acyclic. The spec §5 compatibility check verified the boundary
`allow`-list but **missed the separate circular-dependency rule**. Resolved with
`ignoredCircularDependencies: [['test-contracts', '*']]` in `eslint.config.js` (one entry clears every
present + future-phase cycle through the registry). **Process lesson:** the nx cache served stale lint
*passes* in the worktree (each implementer/reviewer `nx lint` was a cache hit) — only `--skip-nx-cache`
on real `main` surfaced it. Future phases adding producers to the registry are already covered by the
wildcard ignore; run fixture-touching lint with `--skip-nx-cache` when verifying.
