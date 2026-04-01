---
name: init-docs
description: Initialize/rebuild all agent documentation from code — regenerates all service cards, flow specs, C4 diagrams, and runs cross-domain checks. Run after major refactors or first-time setup.
disable-model-invocation: true
---

## When This Skill Applies
- First-time setup of the documentation system in a fresh clone
- After a major refactor or branch merge that may have drifted derived artifacts
- Periodic full rebuild to reset all generated content to match code
- User invokes `/init-docs`

## What It Does

Nuclear rebuild — regenerates ALL derived artifacts from code in 5 phases. Uses per-service and per-flow background agents to keep the main context clean.

**Parallelism:** Phases 1 (service cards) and 2 (flow specs) are independent and MAY be dispatched concurrently — all 43 agents simultaneously, subject to batching limits. Phase 4 (cross-domain checks) MUST run after Phase 2 completes (reads updated flow specs).

## Checklist

- [ ] 1. **Verify skill infrastructure exists**
  ```bash
  ls .claude/skills/*/SKILL.md | wc -l  # verify count matches expectations
  ls flows/*.flow.yaml
  ```
  If missing, create the skill directories first.

---

### Phase 1 — Service Cards (33 background agents)

- [ ] 2. **Dispatch one background agent per service** using `Agent` tool with `run_in_background: true`.

  Send all 33 agents in parallel batches (max ~10 per message to avoid tool limits):

  **Batch A — Advisory (15):** advisory-ctrl, advisory-bff, advisory-hub, advisory-adpt, advisory-narrative-ctrl, decision-workflow-ctrl, compliance-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, alpha-vantage-adpt, fred-adpt, marketwatch-adpt, sec-edgar-adpt, yahoo-finance-adpt

  **Batch B — Execution (6):** execution-ctrl, execution-hub, execution-adpt, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt

  **Batch C — Investor (7):** investor-ctrl, investor-bff, investor-hub, investor-adpt, dashboard-bff, onboarding-bff, investor-web

  **Batch D — Ledger (5):** ledger-ctrl, ledger-bff, ledger-hub, ledger-adpt, reconciliation-ctrl

  **Sub-agent prompt template** (replace `{domain}` and `{service}`):
  ```
  Audit and regenerate the service card for {service} in domain {domain}.

  READ these files:
  1. services/{domain}/{service}/project.json — name, dependencies
  2. services/{domain}/{service}/src/service.stack.ts — extract all constructs:
     - State: DynamoDB table(s), S3 bucket(s), streams?
     - Ingress: each construct → eventTypes subscribed, handler path
     - Egress: eventTypes map (record type → event config)
     - Orchestration: construct IDs, triggers, timeouts, grantCallbackAccess
     - Facade: GraphQL endpoints if present
     - AgentRuntime: Bedrock AgentCore runtime if present
     - KnowledgeBase: Bedrock Knowledge Base if present
     - AgentMemory: Bedrock Agent Memory if present
     - Standalone Lambdas: NodejsFunction created outside Ingress (e.g. SF-invoked)
  3. services/{domain}/{service}/src/handlers/ — list ALL handler files
  4. services/{domain}/{service}/src/domain/events.ts — event type constants (grouped by direction)
  5. services/{domain}/{service}/test/ — list test files
  6. services/{domain}/{service}/src/constructs/ or src/state-machine/ — workflow definitions (if present)

  WRITE a CLAUDE.md card to services/{domain}/{service}/CLAUDE.md in this format:

  # {service}
  Domain: {domain} | Bus: {domain}Bus
  Stack: services/{domain}/{service}/src/service.stack.ts
  ## State
  - {table/bucket details or "None (stateless adapter)"}
  ## Ingress
  - {Bus} → {service}-{id}-ingress (SQS → Lambda)
    Subscriptions: {events}
  [One block per Ingress construct]
  ## Egress
  - CDC: DynamoDB Streams → {service}-egress (Lambda)
    Emits: {events}
  [Only if Egress construct exists]
  ## Orchestration
  - {ConstructId}: {description} (triggered by {events}, timeout {duration})
    - grantCallbackAccess → {handler} (if task token wiring)
  [Only if Orchestration constructs exist]
  ## Standalone Lambdas
  - {FnName}: {purpose} (invoked by {StateMachine}, not via Ingress)
  [Only if Lambdas exist outside Ingress]
  ## Facade
  - {type}: {endpoint description}
  [Only if Facade construct exists]
  ## AgentRuntime
  - {runtime details}
  [Only if AgentRuntime construct exists]
  ## Handlers
  - {filename} — {purpose}
  [List ALL handler files from src/handlers/]
  ## Event Types (domain/events.ts)
  - {ConstGroupName}: {event1}, {event2}, ...
  [Group by direction: inbound, outbound/CDC, routed]
  ## Tests
  - {filename}
  [List all test files from test/]
  ## Dependencies
  - libs: {list}

  Rules: No prose. Structured facts only. Omit sections with no content. Use actual event names from code.

  VERIFY these checks:
  1. File structure: src/, test/, service.stack.ts, project.json exist
  2. Naming suffix: -ctrl, -bff, -hub, -adpt, or -web
  3. Handler pattern: every Lambda uses event-processor pipeline import
  4. Test coverage: each handler has corresponding test file
  5. Import boundaries: no imports from services/ in src/
  6. CDK pattern: service stack extends ServiceStack base class

  RETURN only this structured summary (do NOT return the full card content):
  SERVICE: {service}
  DOMAIN: {domain}
  CARD: written | failed (reason)
  CHECKS: [pass|fail|warn] per check (1-6)
  ISSUES: one-line per issue, or "none"
  ```

- [ ] 3. **Collect results** — as background agents complete, record each summary. Do NOT read the written CLAUDE.md files — trust the agent summaries.

---

### Phase 2 — Flow Specs (10 background agents)

- [ ] 4. **Dispatch one background agent per flow spec** with `run_in_background: true`. All 10 can go in a single batch.

  Flows: advisory-cycle, deposit, go-live, investor-onboarding, market-data-ingestion, order-execution, order-ledger, portfolio-rebalance, reconciliation, withdrawal

  **Sub-agent prompt template** (replace `{flow}`):
  ```
  Regenerate and validate the flow spec: flows/{flow}.flow.yaml

  STEP 1 — REGENERATE by tracing through code:
  - Read the existing flow spec for structure
  - For each step, verify the event chain:
    a. Find producer: check eventTypes on Egress construct in service.stack.ts
    b. Find bus: same domain = domain bus; cross domain = check adapter stack
    c. Find consumer: grep eventTypes arrays in Ingress constructs
    d. Find handler: read consumer handler for state changes + output events
  - For cross-domain hops, read adapter stacks (services/{domain}/{domain}-adpt/src/service.stack.ts)
  - Update the YAML if anything changed. Write to flows/{flow}.flow.yaml

  STEP 2 — VALIDATE every step against code:
  For each step in the flow:
    a. Subscription exists: grep Ingress eventTypes for the event
    b. Handler exists: check src/handlers/ for matching handler
    c. State change occurs: read handler, verify WriteIntent
    d. Output event emitted: verify eventTypes on Egress construct
    e. Cross-domain: verify adapter EB Rule detailType array on source bus

  RETURN only this structured summary:
  FLOW: {flow}
  STEPS: N total
  VALID: N steps verified against code
  BROKEN: N steps (list: step N — reason)
  CHANGED: yes|no (was the YAML modified?)
  ISSUES: one-line per issue, or "none"
  ```

- [ ] 5. **Collect results** — record each flow summary as agents complete.

---

### Phase 3 — C4 Diagrams (shell commands)

- [ ] 6. **Generate D2 sources and compile SVGs**
  ```bash
  node tools/generate-c4-sources.mjs    # Stage 1: D2 from CDK stacks
  node tools/generate-c4-diagrams.mjs   # Stage 2: D2 → navigable SVGs
  ```
  Verify: `ls docs/architecture/nestfolio/index.svg`

---

### Phase 4 — Cross-Domain Checks (1 background agent)

- [ ] 7. **Dispatch a single cross-domain verification agent** with `run_in_background: true`:
  ```
  Perform cross-domain consistency checks on the Nestfolio monorepo.

  CHECK 1 — Adapter subscription coverage:
  For each adapter (advisory-adpt, execution-adpt, investor-adpt, ledger-adpt):
  - Read the adapter's service.stack.ts
  - List all EB Rule detailType arrays (events subscribed from source buses)
  - For each subscribed event, verify it is actually emitted by a service in the source domain
  - Flag: events subscribed but not emitted, events emitted but not subscribed

  CHECK 2 — Orphan services:
  - ls services/*/* and verify every service belongs to one of: advisory, execution, investor, ledger

  CHECK 3 — Flow spec coverage:
  - List all event types emitted (from Egress eventTypes across all services)
  - Check which appear in at least one flows/*.flow.yaml
  - Flag events not covered by any flow spec

  CHECK 4 — Skill freshness:
  - For each .claude/skills/*/SKILL.md, grep for file paths mentioned
  - Verify referenced paths exist on disk

  RETURN only this structured summary:
  ADAPTER_COVERAGE: [domain]: N subscribed, N verified, N missing
  ORPHANS: list or "none"
  FLOW_COVERAGE: N/M event types covered
  UNCOVERED_EVENTS: list
  SKILL_FRESHNESS: N/M skills have valid paths (M = total discovered), list broken refs
  ```

---

### Phase 5 — Report & Commit

- [ ] 8. **Aggregate all results** into this summary:
  ```
  ## /init-docs Results

  ### Service Cards
  - Generated: N/33
  - Failed: N (list failures)
  - Checks: N pass, N fail, N warn

  ### Flow Specs
  - Validated: N/10
  - All valid: N
  - Broken steps: N (list)
  - Modified: N

  ### C4 Diagrams
  - Stage 1 (D2 sources): success|failed
  - Stage 2 (SVG render): success|failed

  ### Cross-Domain Checks
  - Adapter coverage: summary per domain
  - Orphans: N
  - Flow coverage: N/M events
  - Skill freshness: N/M

  ### Files Changed
  [list of created/modified files from git status]
  ```

- [ ] 9. **Regenerate flow docs** from validated specs:
  ```bash
  node tools/generate-flow-docs.mjs
  ```

- [ ] 10. **Present summary for review** — do NOT auto-commit. Ask user to review, then commit if approved:
  ```bash
  git add services/*/*/CLAUDE.md flows/*.flow.yaml docs/architecture/nestfolio/ docs/data-flows/
  git commit -m "docs: regenerate all service cards, flow specs, and C4 diagrams via /init-docs"
  ```

## Context Budget

| Phase | Agents | Context impact on main |
|-------|--------|----------------------|
| Service cards | 33 background | ~33 structured summaries (~3KB total) |
| Flow specs | 10 background | ~10 structured summaries (~1KB total) |
| C4 diagrams | 0 (shell) | ~5 lines output |
| Cross-domain | 1 background | ~1 structured summary (~500B) |
| **Total** | **44 agents** | **~5KB in main context** |

## Failure Handling

- **Agent timeout/failure:** Report in summary, do NOT block other phases. Retry once on timeout.
- **Partial success:** If N of 33 service card agents fail, continue with Phases 2-4. Mark run as partial in summary.
- **C4 tool failure** (e.g. `d2` not installed): Report in summary, does not block other phases.
- **Flow spec agent failure:** Report the specific flow as "failed to validate", continue with others.
- **Final summary** must clearly distinguish: success / partial (list failures) / failed (critical blockers).

## Anti-Patterns
- NEVER batch multiple services into one sub-agent — one agent per service for context isolation
- NEVER return full CLAUDE.md content to the main context — summaries only
- NEVER skip Stage 1 of C4 pipeline — running only Stage 2 after CDK changes produces stale diagrams
- NEVER auto-commit — present summary for human review first
- NEVER run sequentially — use `run_in_background: true` throughout
- NEVER dispatch all 33+10 agents in a single message — use batches of ~10 per message
