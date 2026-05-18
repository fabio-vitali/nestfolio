---
id: cdk-bundle-staleness-deploy-integrity
status: parking
type: tooling
notes: "Hypothesis: 2026-05-13 dev-investor-bff deploy produced a Lambda bundle whose change-data-capture.ts logic lagged behind source. Surfaced via update-operating-mode-cdc-silent. Need a deploy-time integrity check that the bundle's resolveEmissions actually matches the EVENT_TYPE_MAP shape it'll be asked to process."
references:
  - infrastructure/scripts/deploy.sh
  - libs/event-processor/src/pipelines/change-data-capture.ts
  - libs/cdk-constructs/src/core/event-types.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Deploy-time integrity check: bundle's resolveEmissions matches EVENT_TYPE_MAP shape

Surfaced 2026-05-18 during the [[update-operating-mode-cdc-silent]] investigation.

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
