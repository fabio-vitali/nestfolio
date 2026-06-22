---
id: cdk-bundle-staleness-deploy-integrity
status: shipped
type: tooling
closed: 2026-06-22
notes: "Hypothesis: 2026-05-13 dev-investor-bff deploy produced a Lambda bundle whose change-data-capture.ts logic lagged behind source. Surfaced via update-operating-mode-cdc-silent. Need a deploy-time integrity check that the bundle's resolveEmissions actually matches the EVENT_TYPE_MAP shape it'll be asked to process. Resolution (epic --auto, user-confirmed): runtime config-vs-capability INIT guard in changeDataCapture (RC0 blast radius), not the build-stamp/post-deploy-grep alternatives."
references:
  - infrastructure/scripts/deploy.sh
  - libs/event-processor/src/pipelines/change-data-capture.ts
  - libs/cdk-constructs/src/core/event-types.ts
out_of_scope:
  - "The build-time source-stamp + CDK-expected-version assertion approach (rejected: a source-derived stamp can't detect esbuild-cache staleness and touches the shared Egress construct)."
  - "The post-deploy bundle-marker grep in deploy.sh (rejected: fragile vs minification, deploy-script + AWS-CLI coupled)."
  - "Catching same-shape logic regressions (e.g. a field-change emission bug) — the INIT guard catches unrecognized/malformed mapping SHAPES, not handler-logic drift within a recognized shape."
  - "The 3 sibling detect-* members of this epic (separate workstreams)."
spec: null
plan: null
topic_memory: []
validation_gate: "Runtime config-vs-capability INIT guard in changeDataCapture (commit 2c57ecbc): exported classifyMappingShape discriminator (mirrors resolveEmissions' branch order) + assertRuntimeConfigResolvable, throws loud at INIT on any EVENT_TYPE_MAP mapping shape the bundle cannot resolve (stale-bundle class), unconditionally for every CDC service. Validation: (1) change-data-capture.test.ts 28/28 incl. 5 new guard tests (classifier + INIT-throw + legacy-mode + all-valid no-throw); (2) true-affected test+lint GREEN across 35 projects; (3) REAL deployed-config scan — classifier run over 4 dev EVENT_TYPE_MAPs (investor-bff, broker-alpaca-adpt, execution-ctrl, advisory-bff) covering all 4 shape types: every mapping resolves, guard is a no-op for production configs. Per-member 28-service deploy deferred to the epic E6 batched deploy (event-processor consumer fan-out = E6 scope); E6 real-deploys the guard into every CDC Lambda (INIT-exercised) + e2e CDC flows."
epic: deploy-tooling-integrity
epic_role: core
---

# Deploy-time integrity check: bundle's resolveEmissions matches EVENT_TYPE_MAP shape

Surfaced 2026-05-18 during the [[update-operating-mode-cdc-silent]] investigation.

> **2026-05-21 — premise weakened.** The originating incident recurred on 2026-05-21 against a deployed bundle that had NOT changed since 2026-05-18 (EgressPublisher Lambda `LastModified` 2026-05-18T13:09:42). The stale-bundle root cause is therefore falsified — see [[update-operating-mode-cdc-silent]]. A deploy-time bundle-integrity check has standalone merit, but it would NOT have caught the 2026-05-21 recurrence. Re-evaluate whether this item still earns a slot.

## Evidence

- The 2026-05-08 resplit shipped `change-data-capture.ts` with the `always`+`onFieldChange` logic (commit `7862b7fb`).
- The `dev-investor-bff` CFN stack was last updated 2026-05-13 13:17 UTC — supposed to deploy current source.
- On 2026-05-18 12:19 UTC, `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` failed at line 182 — semantic event arrived, carrier did not.
- After re-deploying investor-bff (with diagnostic instrumentation that added zero functional change), the bug disappeared. 7/7 consecutive PASS post-redeploy.
- Direct CloudWatch evidence post-redeploy: publisher emits both events in one PutEvents batch (`publish OK 2`).

The simplest hypothesis that fits the evidence: the 2026-05-13 deploy produced a Lambda bundle whose `change-data-capture.ts` lagged behind source. Cause unknown — possible candidates:

1. **CDK asset hash collision** — unlikely but possible if two different bundle outputs produced the same hash, causing CDK to skip the re-publish.
2. **esbuild cache staleness** — `node_modules/.cache/` or a build-time TS incremental cache held onto the pre-resplit transpile.
3. **pnpm hoisting hiccup** — `@nestfolio/event-processor` was resolved to an older symlinked version at bundle time.

Cannot be verified retroactively (Lambda version history shows only `$LATEST`).

## Cheapest fix candidate (when promoted)

`infrastructure/scripts/deploy.sh` post-deploy step: after each `--services=X` deploy, run a grep over the new bundle (`aws lambda get-function ... | bsdtar -xf - ...`) to confirm the bundle contains expected source markers. Example marker: `"always" in mapping` from `resolveEmissions`. If missing → fail loud.

Alternatively: a **runtime self-check** on Lambda cold-start that validates the runtime's `resolveEmissions` handles all mapping shapes present in `EVENT_TYPE_MAP`. Throw at INIT if the shapes don't match, so the deploy's smoke test catches the mismatch before traffic flows.

## Why parking, not queued

- Hypothesis unverified — could equally be a transient EB-side delivery flake.
- Recurrence pattern unknown (1 reported instance so far).
- Adding deploy-time integrity checks has cost (slower deploys, more brittleness) — should only pay that cost when the staleness pattern recurs and the trigger is identifiable.

Promote when:
- A second deploy-staleness incident surfaces (any service, any bundle), OR
- A reliable repro of CDK skipping a re-bundle is found in isolation.

## Related

- [[update-operating-mode-cdc-silent]] — originating incident (shipped).
- [[jest-worker-scratch-leak-on-force-exit]] — separate but adjacent "AWS infra hides problems we can't observe" pattern.
