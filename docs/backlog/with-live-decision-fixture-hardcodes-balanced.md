---
id: with-live-decision-fixture-hardcodes-balanced
status: dropped
rank: null
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Already shipped as a side-effect of the 2026-05-10 MANDATE_SNAPSHOT_CREATED rewiring (commit 0d326a25) + the 2026-05-11 event-name rename (095973d8). Fixture now exposes operatingMode? defaulting to 'BALANCED' and propagates it to both MANDATE_ISSUED and INVESTOR_PROFILE_UPDATED event details."
---

# `withLiveDecision` fixture hardcodes operatingMode=BALANCED

`apps/e2e-feature-tests/src/helpers/fixtures.ts:231` makes the fixture unusable for any test that needs to control mode. Surfaced 2026-05-06 during Phase 2 e2e gate scaffolding (`operating-mode-recommendation-shape.e2e.test.ts` had to inline-publish the trigger event to control mode). Tiny refactor: add `operatingMode?: 'CONSERVATIVE'|'BALANCED'|'AGGRESSIVE'` option, default BALANCED for back-compat, propagate to event detail. Promote when a second mode-aware e2e test needs the fixture.

## Dropped 2026-05-11 — already resolved

`git blame -L 213,225 apps/e2e-feature-tests/src/helpers/fixtures.ts` shows commit `0d326a25` (2026-05-10) introduced the exact prescribed shape on the `withLiveDecision` fixture: `operatingMode?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'` option, default `'BALANCED'`, propagated to both `MANDATE_ISSUED` (line 240) and `INVESTOR_PROFILE_UPDATED` (line 258) event details. That commit landed as part of the natural-chain rewiring (MANDATE_ISSUED → MandateSnapshot CDC → SF trigger) — same workstream incidentally satisfied this dossier's scope.

No work to do. Marking `dropped`, not `shipped`, because the change was done by an earlier commit. Migrating the inline-publishing caller (`operating-mode-recommendation-shape.e2e.test.ts`) to use the fixture is a separate concern, not in this dossier's scope.
