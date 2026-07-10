# Deploy-need detection — path mapping

Used by `detect-deploy-needed.mjs`. Defines which changed paths trigger a dev-sandbox deploy in the closing phase.

## Tier 1 — Deploy required

| Path glob | Why |
|---|---|
| `infrastructure/**` | Shared CDK constructs and deployment scripts |
| `services/*/*/src/**` | Lambda runtime code (event-listeners, handlers, JS resolvers) |
| `services/*/*/infrastructure/**` | Per-service CDK stack |
| `services/*/*/domain/**` | Event/intent contracts compiled into Lambda bundles |
| `libs/event-processor/**` | Used by every Lambda |
| `libs/cdk-constructs/**` | Used by every service stack |
| `libs/agent-orchestrator/**` | Used by every agent-ctrl service |
| `libs/event-types/**` | Branded event names compiled into Lambdas |
| `services/investor/investor-web/**` | Frontend shell stack (CloudFront + Native Federation) — lives under `services/`, matched by the `services/*/*` rules above |
| `apps/*-mfe/**` | A micro-frontend (deployed via its own `deploy-mfe` target) |
| `apps/nestfolio-host/**` | Shell host bundle — deployed via `investor-web:deploy-shell` (see DEPLOY_VIA) |
| `libs/ui/**`, `libs/frontend-deps/**`, `libs/shell/**` | Frontend libraries used by the MFEs + shell host |

### noRuntimeDeploy (Tier 1, but `deploy=false` when alone)

| Path glob | Why |
|---|---|
| `libs/test-support/**` | Integration-test harness — NOT in any deployed bundle |
| `libs/integration-testing/**` | Same — for the harness, not the Lambdas |

These are flagged `noRuntimeDeploy: true`. A change touching **only** these yields `deploy=false`
(the integration suites pick up the new harness code locally without a redeploy). When they change
**alongside** a real-deploy path, the deploy proceeds but these files are **excluded from the
resolver seed**, so a one-line harness edit no longer fans the deploy out to its whole ~27-service
consumer closure.

## Tier 0 — No deploy

| Path glob | Why |
|---|---|
| `services/*/*/test/**` | Per-service tests — never compiled into a deployed bundle, so a test-only service change requires no deploy and must not seed the true-affected resolver. (TIER1 service rules only match `src/`/`infrastructure/`/`domain/`.) |
| `apps/e2e-feature-tests/**` | Test harness, not deployed |
| `apps/nestfolio-e2e/**` | Playwright harness, not deployed |
| `docs/**` | Documentation |
| `flows/**` | Flow specs (read by audits, not by Lambdas) |
| `.claude/**` | Skills, agent config |
| `tools/**` | Repo tooling (check-scripts, resolver) — never a deploy artifact |
| `runtime/**` | Long-Horizon Engineering Runtime (ring-1 engine + content ring) — a pure node library run by `node --test`, with no CDK stack/Lambda/service; never compiled into a deployed bundle |
| `scripts/**` | Root build/verify/benchmark tooling (`benchmark-agents`, `backlog-regression`, `assert-shell-html`, …) — never a deploy artifact. Deploy scripts live under `infrastructure/scripts/` (matched by the TIER1 `infrastructure/**` rule). |
| `.github/**` | CI workflows + scripts — never a deploy artifact |
| `MEMORY.md` | Agent memory |
| `*.md` at root | README, CHANGELOG, etc. |
| `.gitignore`, `.editorconfig`, IDE config | Tooling |

## Default rule

If a changed path matches NO rule above, the script flags it as `deploy=true` with rationale `unknown path — defaulting to conservative deploy`. The agent can override if confident the path doesn't affect deployed artifacts.

## Affected `--services=` targets (true-affected resolver)

`services=` is computed by `tools/affected-projects.mjs` (reverse-reachability
over `nx graph`), **not** by path-extraction. `classifyChanges` returns the
real-deploy **seed** files (Tier 0 and `noRuntimeDeploy` harness libs already
excluded); `resolveDeployServices(graph, seedFiles)` then:

1. runs the resolver to get the full dependent **project** closure of the seed;
2. keeps only projects that are **independently deployable** — i.e. have a
   `deploy` or `deploy-mfe` nx target (every service stack, `investor-web`, and
   each `*-mfe`). This replaces the older `root.startsWith('services/')` filter,
   which silently dropped the `apps/`-rooted micro-frontends → empty `services=`;
3. remaps the **deploy-coupled** projects through `DEPLOY_VIA` — the shell host
   (`nestfolio-host`) and the federation singleton lib (`frontend-deps`) have no
   deploy target of their own and are uploaded by `investor-web:deploy-shell`
   (deploy.sh Phase 4c), so a change to either resolves to `investor-web`.

The Tier 1 `deploy=true/false` decision stays path-based; only the target list is
resolver-computed.

Consequences:

- A **shared backend-lib** change (`libs/event-processor`, `cdk-constructs`,
  `agent-orchestrator`, `event-types`) resolves to its true dependent **service**
  closure (+ `investor-web` where it depends on the lib).
- A **frontend** change resolves to a correct, **non-empty** target: `libs/ui` →
  the consuming MFEs + `investor-web`; `libs/shell` → all MFEs + `investor-web`;
  a `*-mfe` change → just that MFE; `nestfolio-host`/`frontend-deps` →
  `investor-web`. (Previously these emitted `deploy=true` with `services=[]`, a
  silent `deploy.sh` no-op against stale code.)

If `nx graph` is unavailable (no `node_modules`), detect-deploy falls back to the
path-extracted service names. `tools/**` is Tier 0, so a tooling change never
widens the deploy set.

> **Known residue** (tracked: `detect-deploy-test-lib-reverse-reach-fanout`): the
> resolver still reverse-reaches *through* test-only libs (`test-contracts`,
> `test-support`, `integration-testing`), so a single real **service** `src/**`
> change over-approximates to the whole ~27-service closure. Safe (over-deploys,
> never empty) but not minimal; the fix prunes deploy-inert projects from the
> deploy-closure graph locally.
