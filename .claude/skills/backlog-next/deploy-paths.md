# Deploy-need detection — path mapping

Used by `detect-deploy-needed.mjs`. Defines which changed paths trigger a dev-sandbox deploy in the closing phase.

## Tier 1 — Deploy required

| Path glob | Why |
|---|---|
| `infrastructure/**` | Shared CDK constructs and deployment scripts |
| `services/*/src/**` | Lambda runtime code (event-listeners, handlers, JS resolvers) |
| `services/*/infrastructure/**` | Per-service CDK stack |
| `services/*/domain/**` | Event/intent contracts compiled into Lambda bundles |
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
| `MEMORY.md` | Agent memory |
| `*.md` at root | README, CHANGELOG, etc. |
| `.gitignore`, `.editorconfig`, IDE config | Tooling |

## Default rule

If a changed path matches NO rule above, the script flags it as `deploy=true` with rationale `unknown path — defaulting to conservative deploy`. The agent can override if confident the path doesn't affect deployed artifacts.

## Affected services

For Tier 1 paths matching `services/<svc>/**`, the service name is extracted and added to the `services` output list. The agent uses this to scope `deploy.sh --services=<list>`.

For shared-lib paths (`libs/**`) and `infrastructure/**`, no specific service is implied — the deploy may need broader scoping or a full deploy. Agent decides.
