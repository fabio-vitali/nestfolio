---
id: with-live-decision-fixture-hardcodes-balanced
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Tiny refactor — add operatingMode option, propagate to event detail."
---

# `withLiveDecision` fixture hardcodes operatingMode=BALANCED

`apps/e2e-feature-tests/src/helpers/fixtures.ts:231` makes the fixture unusable for any test that needs to control mode. Surfaced 2026-05-06 during Phase 2 e2e gate scaffolding (`operating-mode-recommendation-shape.e2e.test.ts` had to inline-publish the trigger event to control mode). Tiny refactor: add `operatingMode?: 'CONSERVATIVE'|'BALANCED'|'AGGRESSIVE'` option, default BALANCED for back-compat, propagate to event detail. Promote when a second mode-aware e2e test needs the fixture.
