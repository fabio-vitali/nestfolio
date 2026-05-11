---
id: operating-mode-changed-compliance-mandate-snapshot-e2e
status: parking
rank: null
type: design
notes: "Cross-service E2E reservation: updateOperatingMode mutation → INVESTOR_PROFILE_UPDATED+OPERATING_MODE_CHANGED CDC → advisory-adpt → AdvisoryBus → compliance-ctrl → MandateSnapshot.operatingMode patch. Currently only the investor-bff side (profile.operatingMode) is asserted; the cross-service propagation chain is untested."
references:
  - "services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js"
  - "services/investor/investor-bff/CLAUDE.md"
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_operating_mode.md
validation_gate: null
---

# Cross-service E2E: `OPERATING_MODE_CHANGED` → compliance-ctrl `MandateSnapshot` patch

**Origin:** former `it.skip('should propagate OPERATING_MODE_CHANGED to compliance-ctrl MandateSnapshot', …)` placeholder in `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (removed 2026-05-11 along with the parent investor-bff workstreams to take the suite to a true 18/18 green; this dossier preserves the coverage gap).

## What's currently covered
- investor-bff unit + integration: `updateOperatingMode` mutation writes `operatingMode` onto the composite InvestorProfile row.
- investor-bff CDC: `INVESTOR_PROFILE_UPDATED` (carrier) + `OPERATING_MODE_CHANGED` (semantic) emit on the field change (declarative `onFieldChange`, post-resplit).

## What's NOT covered end-to-end
The downstream chain:

```
investor-bff CDC OPERATING_MODE_CHANGED
  → advisory-adpt EventBridge rule (cross-domain forward)
  → AdvisoryBus
  → compliance-ctrl subscription handler
  → compliance-ctrl table: MandateSnapshot row patch (operatingMode)
```

No test asserts the MandateSnapshot row actually receives the patch when the investor flips operating mode.

## Why this matters
`MandateSnapshot` is the compliance authority resolver's read source for mode-aware policy evaluation (see `project_operating_mode.md`). A silent break in this chain would mean compliance decisions continue applying the stale mode without anyone noticing until the user files a "why was my conservative trade rejected as aggressive" ticket.

## Resolution path

Belongs in `apps/e2e-feature-tests`, not the investor-bff integration suite — the assertion crosses two services + two domains. Sketch:

1. Use `e2e-feature-tests` scaffolding (see `create-e2e-test` skill).
2. Drive: `updateOperatingMode` mutation via the AppSync client.
3. Assert: compliance-ctrl `MandateSnapshot` row's `operatingMode` field flips to the new value within a bounded wait (waitForItem with `operatingMode: 'X'` predicate).
4. Treat as test-passes-when-chain-completes; no assertion on intermediate hops (events are an implementation detail).

Out-of-scope for now: simulating compliance-ctrl latency, error-path testing (adapter rule mismatch, compliance handler failure).

Promote to QUEUED only when there's evidence of intent to ship the e2e (or when a related compliance regression makes it urgent).
