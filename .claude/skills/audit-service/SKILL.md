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
   - Step Functions: state machine names and purposes
   - Facade: GraphQL/REST endpoints if present
   - AgentRuntime: Bedrock agent if present
3. services/{domain}/{service}/src/handlers/ — list all handler files
4. services/{domain}/{service}/src/domain/events.ts — event type constants
5. services/{domain}/{service}/test/ — list test files

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

## Step Functions
- {SFName}: {one-line description}
[Only if state machines exist]

## Facade
- {type}: {endpoint description}
[Only if Facade construct exists]

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
| 4 | Test coverage: every handler has corresponding test | Warning | Compare handler vs test file lists |
| 5 | CDK pattern: extends ServiceStack | Warning | Read service.stack.ts imports |
| 6 | Card freshness: CLAUDE.md matches code | Auto-fix | Regenerate and compare |
| 7 | Import boundaries: no imports from `services/` | Hard fail | `grep -r "from.*services/" src/` |

### Self-Healing
- **Card stale/missing** → Auto-fix: regenerate silently
- **Test file missing** → Scaffold stub, present for approval
- **Import violation** → Hard fail: report file:line

## Reference Files
- CDK base: `libs/cdk-constructs/src/core/service-stack.ts`
- Constructs: `libs/cdk-constructs/src/core/{state,ingress,egress,facade,orchestration}.ts`, `libs/cdk-constructs/src/extensions/agent-runtime.ts`
- Pipelines: `libs/event-processor/src/pipelines/`

## Anti-Patterns
- NEVER hand-write a service card — always generate from code
- NEVER skip verification checks after generation
- NEVER manually edit a card expecting it to persist — next audit overwrites
