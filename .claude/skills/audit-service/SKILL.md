---
name: audit-service
description: Audit and regenerate a service's CLAUDE.md card from code. Use to verify service consistency or regenerate stale service cards.
---

## When This Skill Applies
- After modifying a service (as final step of any implement/ skill)
- Verifying a service follows conventions
- Regenerating a stale or missing service card
- Called by audit-domain during domain sweeps

## Checklist

### Card Generation

Dispatch a sub-agent with this prompt (replace `{domain}` and `{service}`):

```
Audit the service {service} in domain {domain}. Read these files:

1. services/{domain}/{service}/project.json — extract name, dependencies
2. services/{domain}/{service}/src/service.stack.ts — extract:
   - State: DynamoDB table(s), S3 bucket(s), streams enabled?
   - Ingress: each Ingress construct → event types subscribed, handler path
   - Egress: CDC config → eventTypes map (record type → event config)
   - errorEventType: check createIngestionHandler/materializeToTable calls for errorEventType parameter
   - Agent PutEvents: check for grantPutEventsTo in CDK stack (indicates Lambda publishes events directly)
   - Facade noneDataSource: check for noneDataSource resolvers that publish events via EventBridge
   - Orchestration triggers: check triggers in Orchestration construct config
   - Orchestration: construct IDs, triggers, timeouts, grantCallbackAccess
   - Facade: GraphQL/REST endpoints if present
   - AgentRuntime: Bedrock agent if present
3. services/{domain}/{service}/src/handlers/ — list all handler files
4. services/{domain}/{service}/src/domain/events.ts — event type constants
5. services/{domain}/{service}/test/unit/ and test/integration/ — list test files

Produce a CLAUDE.md service card in EXACTLY this format:

# {service}

Domain: {domain} | Bus: {domain}Bus
Stack: services/{domain}/{service}/src/service.stack.ts

## State
- {TableName} (DynamoDB, streams {enabled|disabled})
- {BucketName} (S3) — if present

## Ingress
- {Bus} → {service}-{name}-ingress (SQS → Lambda)
  Subscriptions: {EVENT_1}, {EVENT_2}, ...
[One block per Ingress construct]

## Egress
- CDC: DynamoDB Streams → {service}-egress (Lambda)
  Emits: {EVENT_1}, {EVENT_2}, ...
[Only if Egress construct exists]

## Orchestration
- {ConstructId}: {description} (triggered by {events}, timeout {duration})
  - grantCallbackAccess → {handler} (if task token wiring)
[Only if Orchestration constructs exist]

## Standalone Lambdas
- {FnName}: {purpose} (invoked by {StateMachine}, not via Ingress)
[Only if Lambdas exist outside Ingress — e.g. SF-invoked functions]

## Facade
- {type}: {endpoint description}
[Only if Facade construct exists]

## Handlers
- {filename} — {purpose}
[List all handler files from src/handlers/]

## Event Types (domain/events.ts)
- {ConstGroupName}: {event1}, {event2}, ...
[Group by direction: inbound (subscribed), outbound (emitted via CDC), routed]

## Tests
- {filename}
[List all test files from test/]

## Dependencies
- libs: {lib1}, {lib2}, ...

RULES:
- No prose. Structured facts only.
- Omit sections with no content.
- Use actual event type constant names from code.
- If no State construct is created (e.g. cross-domain ingestion adapters), State section: "None (stateless adapter)"

Write the result to: services/{domain}/{service}/CLAUDE.md
```

### Verification Checks

| # | Check | Severity | How to Check |
|---|-------|----------|-------------|
| 1 | File structure: `src/`, `test/`, `src/service.stack.ts`, `project.json` | Hard fail | `ls` the paths |
| 2 | Naming: suffix is `-ctrl`, `-bff`, `-hub`, `-adpt`, or `-web` | Hard fail | Parse directory name |
| 3 | Handler pattern: every Lambda uses event-processor pipeline | Hard fail | Grep handlers for pipeline imports |
| 4 | Unit test coverage: every handler has corresponding test in test/unit/ | Warning | Compare handler vs test file lists |
| 5 | CDK pattern: extends ServiceStack | Warning | Read service.stack.ts imports |
| 6 | Card freshness: CLAUDE.md matches code | Auto-fix | Regenerate and compare |
| 7 | Import boundaries: no imports from `services/` | Hard fail | `grep -r "from.*services/" src/` |
| 8 | Event emission completeness: all emission paths documented in card | Warning | Check CDC Egress, errorEventType, grantPutEventsTo, noneDataSource resolvers, SF PutEvents integrations |
| 9 | Integration test coverage: test/integration/ exists and passes audit-integration-test (gated on service suffix) | Hard fail | `ls test/integration/`; if absent → hard fail (for -ctrl/-bff/-adpt only); if present → invoke audit-integration-test skill |
| 10 | Read-model ownership: no drift + no structural-zero | Hard fail (drift) / Warning (structural-zero) | Run `pnpm nx run event-processor:read-model-drift`; plus the structural-zero prose check below |

**Read-model ownership sub-check (check #10)** — see `docs/architecture/READ-MODEL-OWNERSHIP.md`:

- **Drift (hard fail):** run `pnpm nx run event-processor:read-model-drift` (or `node tools/check-read-model-drift.mjs`). It is repo-wide; treat any reported violation that names a row written by *this* service as a hard fail. The four classes: a `Projection` written by `accumulate`; a `Projection<'P1'>` written by a non-`projectVersioned` factory (no version guard); a `__typename` written by both a command resolver (`*.fn.js`) and an event-side ongoing intent (dual authority — only the `record`-seed pattern may coexist); the same `__typename` registered with conflicting tags; an intent-factory write that is neither registered nor excluded (R5); a `(service, typename)` both registered and excluded (R6).
- **Unclassified write (hard fail):** the gate errors (`unclassified-write`) on any intent-factory write that is neither registered in a `ReadModelOwnership` augmentation nor listed in `tools/read-model-exclusions.json`. Treat any such error naming a row written by *this* service as a hard fail — register it (CommandOwned / Projection) or add an exclusion entry with a reason if it is a verified non-governed outbox/carrier/feed-cache row.
- **Structural-zero (warning, prose — the checker cannot see this):** for each field in the service's read-type SDL (`src/schema.graphql`), confirm some transform/factory call actually writes it. A schema field never written is a structural zero (the bug class the redesign dissolved); flag it.

**Integration test sub-check (check #9)**: Determine applicability by service suffix, then act:

- **`-ctrl`, `-bff`, `-adpt`** (backend business services): if `test/integration/` exists, invoke the `audit-integration-test` skill and incorporate its findings into the audit report. If the directory is absent, hard-fail with the message: `"Service has no test/integration/ directory — integration tests are required for all -ctrl/-bff/-adpt services. Add tests via create-integration-test skill."`
- **`-hub`** (event bus routers): skip check #9 entirely. Hubs are pass-through EventBridge routers with no business logic; the integration test model does not apply. Report as `"N/A — hub services route events, no integration test required."`
- **`-web`** (Angular frontends / MFEs): skip check #9 entirely. Web apps use a different test model (Angular component tests, E2E via Playwright/Cypress) and do not consume the `@nestfolio/integration-testing` lib. Report as `"N/A — web services use a different test model."`

### Self-Healing
- **Card stale/missing** → Auto-fix: regenerate silently
- **Test file missing** → Scaffold stub, present for approval
- **Import violation** → Hard fail: report file:line

## Reference Files
- CDK base: `libs/cdk-constructs/src/core/service-stack.ts`
- Constructs: `libs/cdk-constructs/src/core/{state,ingress,egress,facade,orchestration}.ts`, `libs/cdk-constructs/src/extensions/agent-runtime.ts`
- Pipelines: `libs/event-processor/src/pipelines/`

## Remediation Plan

After presenting verification results, if any hard-fail checks exist:

1. **Collect failures** — group all hard-fails and warnings by category:
   - Structure issues (missing files, wrong naming, import violations)
   - Handler issues (missing event-processor pipeline usage)
   - Test issues (missing unit tests, integration test gaps)
   - Card issues (stale or missing CLAUDE.md)
   - Event issues (undocumented emission paths)

2. **Map each failure to a fixing skill:**

   | Failure Category | Fixing Skill |
   |-----------------|--------------|
   | Missing file structure | `create-service` (if new) or manual fix |
   | Handler not using pipeline | `event-processor-patterns` (reference for rewrite) |
   | Missing unit tests | `testing-patterns` (scaffold test file) |
   | Missing integration tests | `create-integration-test` |
   | Stale/missing CLAUDE.md card | Auto-fix (regenerate) |
   | Import boundary violation | Manual fix — report file:line |
   | Undocumented event emission | `create-event` or `audit-service` card regeneration |

3. **Present remediation summary** using AskUserQuestion:

   > **{N} issues found for {service}.** Proposed remediation:
   > - {count} auto-fixable (card regeneration)
   > - {count} need integration test scaffolding → `create-integration-test`
   > - {count} need manual code fixes at listed file:line locations
   >
   > Options:
   > - **A) Generate fixing plan** — invoke `writing-plans` with the remediation scope (recommended if ≥3 issues)
   > - **B) Fix now** — apply fixes directly in this session (recommended if ≤2 issues)
   > - **C) Report only** — save the audit report, fix later

4. If user selects **A**: invoke the `writing-plans` skill with the full audit report and mapped skills.
5. If user selects **B**: apply auto-fixes first (card regeneration), then invoke appropriate skills for remaining issues.

**When called as sub-agent by audit-domain:** skip the AskUserQuestion step. Instead, return the structured failure list with mapped skills so the parent audit can aggregate and present a single remediation prompt.

## Anti-Patterns
- NEVER hand-write a service card — always generate from code
- NEVER skip verification checks after generation
- NEVER manually edit a card expecting it to persist — next audit overwrites
- NEVER skip the remediation step when running standalone — always present options after failures
