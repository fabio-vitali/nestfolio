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
| `libs/test-support/**` | NOT used by deployed code — but used by integration tests post-deploy |
| `libs/integration-testing/**` | Same — for the harness, not the Lambdas |
| `apps/investor-web/**` | Frontend (CloudFront + Native Federation) |
| `libs/ui/**`, `libs/frontend-deps/**`, `libs/shell/**` | Frontend libraries used by investor-web |

## Tier 0 — No deploy

| Path glob | Why |
|---|---|
| `apps/e2e-feature-tests/**` | Test harness, not deployed |
| `apps/nestfolio-e2e/**` | Playwright harness, not deployed |
| `docs/**` | Documentation |
| `flows/**` | Flow specs (read by audits, not by Lambdas) |
| `.claude/**` | Skills, agent config |
| `tools/**` | Repo tooling (check-scripts, resolver) — never a deploy artifact |
| `.github/**` | CI workflows + scripts — never a deploy artifact |
| `MEMORY.md` | Agent memory |
| `*.md` at root | README, CHANGELOG, etc. |
| `.gitignore`, `.editorconfig`, IDE config | Tooling |

## Default rule

If a changed path matches NO rule above, the script flags it as `deploy=true` with rationale `unknown path — defaulting to conservative deploy`. The agent can override if confident the path doesn't affect deployed artifacts.

## Affected services (true-affected resolver)

`services=` is computed by `tools/affected-projects.mjs` (reverse-reachability
over `nx graph`), **not** by path-extraction. The script maps the diff (excluding
Tier 0 files) to its true dependent app closure, filtered to `services/` apps.
The Tier 1 `deploy=true/false` decision stays path-based; only the service list
is resolver-computed.

Consequence: a **shared-lib** change (`libs/event-processor`, `cdk-constructs`,
`agent-orchestrator`, `event-types`) now resolves to its true dependent
**service** closure instead of an empty list — closing the gap where a lib edit
emitted `deploy=true` with no `services=`. A single-service `src/**` change
resolves to that service plus any service that imports its `/contracts`
cross-domain (their bundles include the changed code).

If `nx graph` is unavailable (no `node_modules`), detect-deploy falls back to the
old path-extracted service names. `tools/**` is Tier 0, so a tooling change never
widens the deploy set.
