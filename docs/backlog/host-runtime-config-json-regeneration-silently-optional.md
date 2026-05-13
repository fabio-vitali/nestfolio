---
id: host-runtime-config-json-regeneration-silently-optional
status: shipped
type: bug
references: []
out_of_scope:
  - "Refactoring fetch-runtime-config.sh internals (the producer is correct; only its invocation gating is the bug)."
  - "Changing CloudFront invalidation paths (deploy-shell.sh's existing path list stays as-is)."
  - "Adding new SSM parameters or changing the runtime-config payload shape."
  - "Touching deploy-mfe.sh / Phase 4b MFE bundle uploads (orthogonal pipeline)."
  - "Bug 2 (build-cache stale dist) — split out as nestfolio-host-build-cache-gitignore-invalidation-gap; needs a fix path that bypasses .gitignore-aware input hashing."
spec: null
plan: null
topic_memory: []
validation_gate: |
  Bug 1 (deploy.sh Phase 4c gating): dry-run with `--services=advisory-bff` now fires Phase 4c (was previously skipped); dry-run with `--services=portfolio-engine-ctrl` correctly skips it. Full edge-case matrix (6 cases) verified: no-filter→fires, investor-web-only→fires, each of {investor-bff,advisory-bff,ledger-bff,dashboard-bff}→fires, advisory-ctrl→skipped, onboarding-bff→skipped. New helper PHASE4C_TRIGGER OR-gates `is_service_included "investor-web"` with any of the 4 facade-bearing BFFs.
  Syntax: `bash -n infrastructure/scripts/deploy.sh` OK; `jq empty apps/nestfolio-host/project.json` OK.
notes: "Bug 1 shipped; Bug 2 split out — initial fix attempts found ineffective during self-check (.gitignore on config.json defeats input-based cache invalidation)."
---

# Host runtime `config.json` regeneration is silently optional

`apps/nestfolio-host/public/assets/config.json` carries the deployed BFF AppSync URLs, Cognito pool IDs, etc. Two latent bugs surfaced during Spec 5 e2e validation: (1) `infrastructure/scripts/deploy.sh` does not re-run `pnpm nx run nestfolio-host:config --prefix=<prefix>` after BFF redeploys, so a fresh deploy can leave the file pointing at stale URLs; (2) `nestfolio-host:build` does not copy the file from `apps/nestfolio-host/public/assets/` into `dist/apps/nestfolio-host/browser/assets/`, so even when config IS regenerated, the served bundle keeps the old one. Failure mode: shell loads `/assets/config.json` → gets the SPA `index.html` (404 fallback) → `JSON.parse('<!doctype...')` → "Federation init failed" → page renders empty `<generic>Failed to load application</generic>`.

## Ship 2026-05-13 (Bug 1 only)

**Bug 1 fix** — `infrastructure/scripts/deploy.sh` Phase 4c trigger: previously gated solely on `is_service_included "investor-web"`, so any `--services=` filter that listed only BFFs (e.g., post-destroy+recreate of advisory-bff) skipped Phase 4c entirely → deployed S3 `config.json` stayed pointed at the destroyed-then-recreated AppSync API ID. New `PHASE4C_TRIGGER` boolean OR-gates investor-web with any of the 4 facade-bearing BFFs (investor-bff, advisory-bff, ledger-bff, dashboard-bff). Onboarding-bff intentionally excluded — it has `hasFacade: false` and does not publish `api/graphqlUrl`; its only runtime-config touchpoint (AgentCore runtimeUrl) is substituted at CDK synth time into `copilot-rewrite.js`, not through `config.json`.

**Validation evidence (Bug 1)**:
- `bash -n infrastructure/scripts/deploy.sh` — syntax OK.
- Edge-case matrix via `--dry-run`:
  - `--services=advisory-bff` — Phase 4c fires (previously skipped, the broken case).
  - `--services=ledger-bff` — Phase 4c fires.
  - `--services=investor-web` — Phase 4c fires (preserved).
  - (no `--services`) — Phase 4c fires (preserved).
  - `--services=advisory-ctrl` — Phase 4c correctly absent.
  - `--services=onboarding-bff` — Phase 4c correctly absent.

## Bug 2 split-out

During self-check, the initial Bug 2 fix (adding `{projectRoot}/public/**/*` to `nf-build` inputs) was empirically demonstrated to **not work**. Root cause: `.gitignore:51` explicitly excludes `apps/nestfolio-host/public/assets/config.json`, and Nx respects gitignore when hashing file-glob inputs — gitignored files are skipped regardless of whether they match the glob. A follow-up attempt using `{"runtime": "shasum …"}` was inconclusive within the test budget (rebuild exceeds 30s and the harness timed out before validation completed). The right shape requires a deliberate choice between (a) `cache: false` on nf-build, (b) un-gitignoring config.json and relying on git-aware caching, (c) re-validating the runtime-input approach with proper timing, or (d) writing config.json to a non-gitignored location and symlinking. See `docs/backlog/nestfolio-host-build-cache-gitignore-invalidation-gap.md`.

The Bug 2 fix attempt was reverted from `apps/nestfolio-host/project.json` since it gave a false sense of safety. Bug 2 remains latent (cache-hit only manifests when public/config.json content changes between two builds without project.json or another non-gitignored input also changing).
