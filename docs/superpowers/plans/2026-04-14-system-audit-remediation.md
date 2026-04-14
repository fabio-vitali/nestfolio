# System Audit Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate all 28 issues found in the 2026-04-14 system audit — 2 hard-fail categories (C4 diagrams, flow specs), 3 E2E coverage gaps, 5 stale service cards, and minor warnings.

**Architecture:** Work is organized by priority: auto-fixable documentation first (C4 diagrams, service cards), then flow spec gaps (grouped by theme into 5 new specs + 2 additions), then E2E coverage gaps. Each task is independent and produces a commit.

**Tech Stack:** D2 diagram language, YAML flow specs, Jest E2E tests, CDK stacks, event-processor pipelines.

---

## File Map

| Task | Action | Files |
|------|--------|-------|
| 1 | Regenerate | `docs/architecture/c3/*.d2`, `docs/architecture/nestfolio.d2`, `docs/architecture/c3/*.svg`, `docs/architecture/*.svg` |
| 2 | Regenerate | `services/ledger/ledger-ctrl/CLAUDE.md`, `services/ledger/ledger-bff/CLAUDE.md`, `services/ledger/ledger-adpt/CLAUDE.md`, `services/ledger/reconciliation-ctrl/CLAUDE.md`, `services/investor/investor-adpt/CLAUDE.md` |
| 3 | Create | `flows/circuit-breaker.flow.yaml` |
| 4 | Create | `flows/account-closure.flow.yaml` |
| 5 | Create | `flows/incident-escalation.flow.yaml` |
| 6 | Modify | `flows/advisory-cycle.flow.yaml`, `flows/order-ledger.flow.yaml` |
| 7 | Create | `flows/transfer-failure.flow.yaml` |
| 8 | Investigate | `services/execution/execution-adpt/src/service.stack.ts` (orphan DECISION_PACKET_CREATED subscription) |
| 9 | Fix | `.claude/skills/create-service/SKILL.md` (broken `tools/my-tool.schema.json` ref) |

---

### Task 1: Regenerate C4 Diagrams

C4 diagrams are comprehensively stale. All D2 files were last generated 2026-04-01. Since then, 20+ commits modified CDK stacks including Lambda profile migrations, typed event constants, new Lambdas, and state machine additions. 6 files have confirmed content drift: advisory-ctrl, broker-alpaca-adpt, compliance-ctrl, dashboard-bff, ledger-ctrl, nestfolio.d2. investor-web is missing entirely.

**Files:**
- Regenerate: all `docs/architecture/c3/*.d2` (32 files) + `docs/architecture/nestfolio.d2`
- Regenerate: all corresponding SVG files

**Skill:** Invoke `generate-c4-diagrams` to handle both Stage 1 (D2 source generation from CDK stacks) and Stage 2 (D2 → SVG compilation).

- [ ] **Step 1: Run Stage 1 — generate D2 sources from CDK stacks**

```bash
node tools/generate-c4-sources.mjs
```

Expected: All 33 D2 files regenerated in `docs/architecture/c3/`, plus `docs/architecture/nestfolio.d2`.

- [ ] **Step 2: Verify the 6 known-drifted files changed**

```bash
git diff --stat docs/architecture/c3/advisory-ctrl.d2 docs/architecture/c3/broker-alpaca-adpt.d2 docs/architecture/c3/compliance-ctrl.d2 docs/architecture/c3/dashboard-bff.d2 docs/architecture/c3/ledger-ctrl.d2 docs/architecture/nestfolio.d2
```

Expected: All 6 show diffs.

- [ ] **Step 3: Check investor-web D2 was created**

```bash
ls -la docs/architecture/c3/investor-web.d2
```

Expected: File exists (was previously missing).

- [ ] **Step 4: Run Stage 2 — compile D2 → SVG**

Follow the `generate-c4-diagrams` skill for the exact D2 compilation command. Compile all `.d2` files to `.svg`.

- [ ] **Step 5: Visually verify SVG output**

Open a sample of the changed SVGs (at minimum: broker-alpaca-adpt, ledger-ctrl, nestfolio) and confirm they render correctly. The broker-alpaca-adpt diagram should now show the Orchestration construct with 2 state machines.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/
git commit -m "docs: regenerate C4 diagrams from current CDK stacks"
```

---

### Task 2: Regenerate Stale Service Cards

5 service CLAUDE.md cards have drifted from code. All are documentation-only issues — no functional code problems.

**Files:**
- Regenerate: `services/ledger/ledger-ctrl/CLAUDE.md` (missing snapshot-publisher handler, 3 event types, 4 test files, sourcing dep)
- Regenerate: `services/ledger/ledger-bff/CLAUDE.md` (missing integration test file)
- Regenerate: `services/ledger/ledger-adpt/CLAUDE.md` (missing integration test file)
- Regenerate: `services/ledger/reconciliation-ctrl/CLAUDE.md` (missing 2 event types, 2 test files)
- Regenerate: `services/investor/investor-adpt/CLAUDE.md` (missing DEPOSIT_DETECTED in 2 places)

**Skill:** Invoke `audit-service` for each service to regenerate its card from code.

- [ ] **Step 1: Regenerate ledger-ctrl card**

Invoke `audit-service` targeting `services/ledger/ledger-ctrl`. The regenerated card must include:
- `snapshot-publisher.ts` handler (deriveFromStream pipeline)
- Event types: `BALANCE_EVENT_UPDATED`, `PORTFOLIO_EVENT_UPDATED`, `LEDGER_ENTRY_EVENT_UPDATED`
- Test files: `transforms/snapshot-to-events.test.ts`, `handlers/snapshot-publisher.test.ts`, `integration/ledger-ctrl.integration.test.ts`, `integration/ledger-ctrl.resilience.integration.test.ts`
- Dependency: `event-processor/sourcing`

- [ ] **Step 2: Regenerate ledger-bff card**

Invoke `audit-service` targeting `services/ledger/ledger-bff`. Must include `integration/ledger-bff.integration.test.ts`.

- [ ] **Step 3: Regenerate ledger-adpt card**

Invoke `audit-service` targeting `services/ledger/ledger-adpt`. Must include `integration/ledger-adpt.integration.test.ts`.

- [ ] **Step 4: Regenerate reconciliation-ctrl card**

Invoke `audit-service` targeting `services/ledger/reconciliation-ctrl`. Must include:
- Event types: `RECONCILIATION_RESULT_UPDATED`, `DRIFT_RECORD_UPDATED`
- Test files: `integration/reconciliation-ctrl.integration.test.ts`, `integration/reconciliation-ctrl.resilience.integration.test.ts`

- [ ] **Step 5: Regenerate investor-adpt card**

Invoke `audit-service` targeting `services/investor/investor-adpt`. Must include `DEPOSIT_DETECTED` in Execution forwarding list and InvestorIngestEventTypes summary.

- [ ] **Step 6: Verify all 5 cards**

```bash
for svc in services/ledger/ledger-ctrl services/ledger/ledger-bff services/ledger/ledger-adpt services/ledger/reconciliation-ctrl services/investor/investor-adpt; do
  echo "=== $svc ===" && head -5 "$svc/CLAUDE.md"
done
```

- [ ] **Step 7: Commit**

```bash
git add services/ledger/ledger-ctrl/CLAUDE.md services/ledger/ledger-bff/CLAUDE.md services/ledger/ledger-adpt/CLAUDE.md services/ledger/reconciliation-ctrl/CLAUDE.md services/investor/investor-adpt/CLAUDE.md
git commit -m "docs: regenerate 5 stale service cards from code"
```

---

### Task 3: Create Circuit Breaker Flow Spec

4 cross-domain events are undocumented: `CIRCUIT_BREAKER_TRIGGERED` and `CIRCUIT_BREAKER_RESET` (Advisory → Execution + Investor), `BROKER_CIRCUIT_OPEN` (Execution → Investor).

**Files:**
- Create: `flows/circuit-breaker.flow.yaml`

**Skill:** Invoke `generate-flow-spec` to trace the event path through code.

- [ ] **Step 1: Trace circuit breaker event producers**

Find which service emits `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, and `BROKER_CIRCUIT_OPEN`:

```bash
# Check CDC eventTypes in stacks
grep -r "CIRCUIT_BREAKER" services/*/src/service.stack.ts
grep -r "BROKER_CIRCUIT" services/*/src/service.stack.ts
```

- [ ] **Step 2: Trace adapter forwarding rules**

Check `execution-adpt` and `investor-adpt` stacks for the corresponding Ingress rules that forward these events cross-domain.

- [ ] **Step 3: Trace consumers**

Find which services subscribe to these events via their Ingress constructs:

```bash
grep -r "CIRCUIT_BREAKER\|BROKER_CIRCUIT" services/*/src/service.stack.ts | grep -i ingress
```

- [ ] **Step 4: Write the flow spec**

Create `flows/circuit-breaker.flow.yaml` following the format of existing flow specs (see `flows/advisory-cycle.flow.yaml` for reference). Document:
- Trigger: what condition causes the circuit breaker
- Cross-domain hops: Advisory → execution-adpt → ExecutionBus, Advisory → investor-adpt → InvestorBus
- Consumers: which services react and how
- Reset path: CIRCUIT_BREAKER_RESET following the same topology

- [ ] **Step 5: Validate the flow spec**

Invoke `validate-flow` against `flows/circuit-breaker.flow.yaml` to verify subscriptions match code.

- [ ] **Step 6: Commit**

```bash
git add flows/circuit-breaker.flow.yaml
git commit -m "docs: add circuit-breaker flow spec"
```

---

### Task 4: Create Account Closure Flow Spec

`ACCOUNT_CLOSURE_REQUESTED` (Investor → Execution) and `requestAccountClosure` BFF mutation are undocumented.

**Files:**
- Create: `flows/account-closure.flow.yaml`

**Skill:** Invoke `generate-flow-spec` to trace the event path through code.

- [ ] **Step 1: Trace the mutation entry point**

Read `services/investor/investor-bff/src/service.stack.ts` to find the `requestAccountClosure` Facade resolver and its JS resolver file.

- [ ] **Step 2: Trace CDC emission**

Find the CDC configuration that emits `ACCOUNT_CLOSURE_REQUESTED` from investor-bff or investor-ctrl.

- [ ] **Step 3: Trace adapter forwarding**

Check `execution-adpt` for the rule that forwards `ACCOUNT_CLOSURE_REQUESTED` from InvestorBus to ExecutionBus.

- [ ] **Step 4: Trace execution-domain consumers**

Find which execution service(s) subscribe to `ACCOUNT_CLOSURE_REQUESTED` and what they do with it.

- [ ] **Step 5: Write the flow spec**

Create `flows/account-closure.flow.yaml` documenting the full lifecycle from BFF mutation through CDC, adapter forwarding, and execution-domain handling.

- [ ] **Step 6: Validate**

Invoke `validate-flow` against the new spec.

- [ ] **Step 7: Commit**

```bash
git add flows/account-closure.flow.yaml
git commit -m "docs: add account-closure flow spec"
```

---

### Task 5: Create Incident & Escalation Flow Spec

4 cross-domain events: `INCIDENT_DETECTED`, `INCIDENT_RESOLVED`, `ESCALATION_TRIGGERED` (Advisory → Investor), `ORDER_ESCALATED` (Execution → Investor).

**Files:**
- Create: `flows/incident-escalation.flow.yaml`

**Skill:** Invoke `generate-flow-spec` to trace the event paths.

- [ ] **Step 1: Trace all 4 event producers**

```bash
grep -r "INCIDENT_DETECTED\|INCIDENT_RESOLVED\|ESCALATION_TRIGGERED\|ORDER_ESCALATED" services/*/src/service.stack.ts
```

- [ ] **Step 2: Trace adapter forwarding**

Check `investor-adpt` for rules forwarding these events from Advisory/Execution buses to InvestorBus.

- [ ] **Step 3: Trace investor-domain consumers**

Find which investor service(s) subscribe and how they handle these events (likely notification materialization).

- [ ] **Step 4: Write the flow spec**

Create `flows/incident-escalation.flow.yaml` covering both incident lifecycle (detect → resolve) and escalation paths (advisory escalation + order escalation).

- [ ] **Step 5: Validate**

Invoke `validate-flow` against the new spec.

- [ ] **Step 6: Commit**

```bash
git add flows/incident-escalation.flow.yaml
git commit -m "docs: add incident-escalation flow spec"
```

---

### Task 6: Extend Existing Flow Specs

2 events should be added to existing flow specs rather than creating new ones:
- `EXPLANATION_GENERATED` (Advisory → Investor) → add to `advisory-cycle.flow.yaml`
- `LEDGER_PROCESSING_FAILED` (Ledger → Investor) → add to `order-ledger.flow.yaml`

**Files:**
- Modify: `flows/advisory-cycle.flow.yaml`
- Modify: `flows/order-ledger.flow.yaml`

- [ ] **Step 1: Trace EXPLANATION_GENERATED**

```bash
grep -r "EXPLANATION_GENERATED" services/*/src/service.stack.ts
```

Find: producer service, CDC config, adapter rule in investor-adpt, consumer in investor domain.

- [ ] **Step 2: Add EXPLANATION_GENERATED to advisory-cycle.flow.yaml**

Add a step documenting the explanation delivery path:
- advisory-narrative-ctrl (or advisory-bff) emits EXPLANATION_GENERATED via CDC
- investor-adpt forwards from AdvisoryBus to InvestorBus
- dashboard-bff or investor-bff materializes for user consumption

- [ ] **Step 3: Trace LEDGER_PROCESSING_FAILED**

```bash
grep -r "LEDGER_PROCESSING_FAILED" services/*/src/service.stack.ts
```

Find: producer service, CDC config, adapter rule in investor-adpt, consumer.

- [ ] **Step 4: Add LEDGER_PROCESSING_FAILED to order-ledger.flow.yaml**

Add a failure-path step documenting what happens when ledger processing fails.

- [ ] **Step 5: Validate both modified specs**

Invoke `validate-flow` against both `flows/advisory-cycle.flow.yaml` and `flows/order-ledger.flow.yaml`.

- [ ] **Step 6: Commit**

```bash
git add flows/advisory-cycle.flow.yaml flows/order-ledger.flow.yaml
git commit -m "docs: add EXPLANATION_GENERATED and LEDGER_PROCESSING_FAILED to existing flow specs"
```

---

### Task 7: Create Transfer Failure Flow Spec

`TRANSFER_FAILED` (Execution → Ledger + Investor) is undocumented.

**Files:**
- Create: `flows/transfer-failure.flow.yaml`

- [ ] **Step 1: Trace TRANSFER_FAILED producer**

```bash
grep -r "TRANSFER_FAILED" services/*/src/service.stack.ts
```

- [ ] **Step 2: Trace adapter forwarding**

Check `ledger-adpt` and `investor-adpt` for rules forwarding TRANSFER_FAILED.

- [ ] **Step 3: Trace consumers in both domains**

Find what ledger and investor services do when a transfer fails.

- [ ] **Step 4: Write the flow spec**

Create `flows/transfer-failure.flow.yaml` documenting the failure path from execution through both consuming domains.

- [ ] **Step 5: Validate**

Invoke `validate-flow` against the new spec.

- [ ] **Step 6: Commit**

```bash
git add flows/transfer-failure.flow.yaml
git commit -m "docs: add transfer-failure flow spec"
```

---

### Task 8: Investigate Orphan DECISION_PACKET_CREATED Subscription

`execution-adpt` forwards `DECISION_PACKET_CREATED` from Advisory to Execution, but no execution-domain service subscribes to it. Also, `ledger-adpt` forwards `DECISION_PACKET_CREATED` from Execution to Ledger — unclear purpose.

**Files:**
- Investigate: `services/execution/execution-adpt/src/service.stack.ts`
- Investigate: `services/ledger/ledger-adpt/src/service.stack.ts`

- [ ] **Step 1: Check if any execution service consumes DECISION_PACKET_CREATED**

```bash
grep -r "DECISION_PACKET_CREATED" services/execution/*/src/ --include="*.ts" | grep -v "service.stack.ts"
```

- [ ] **Step 2: Check if any ledger service consumes it**

```bash
grep -r "DECISION_PACKET_CREATED" services/ledger/*/src/ --include="*.ts" | grep -v "service.stack.ts"
```

- [ ] **Step 3: Determine if this is intentional (pre-wiring) or an orphan**

If no consumer exists in either domain, this is dead routing. Options:
- **If pre-wiring for future use:** document it with a comment in the adapter stack
- **If orphan:** remove the forwarding rule from execution-adpt and ledger-adpt

- [ ] **Step 4: Act on finding**

If removing: delete the rule and commit. If keeping: add a code comment explaining the pre-wiring intent.

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-adpt/src/service.stack.ts services/ledger/ledger-adpt/src/service.stack.ts
git commit -m "fix: resolve orphan DECISION_PACKET_CREATED adapter subscription"
```

---

### Task 9: Fix Broken Skill Reference

`create-service` skill references `tools/my-tool.schema.json` which does not exist.

**Files:**
- Fix: `.claude/skills/create-service/SKILL.md`

- [ ] **Step 1: Read the create-service skill**

Read `.claude/skills/create-service/SKILL.md` and find the reference to `tools/my-tool.schema.json`.

- [ ] **Step 2: Determine correct path or remove reference**

Check if the file was renamed or moved:
```bash
find tools/ -name "*.schema.json" 2>/dev/null
find . -name "my-tool*" 2>/dev/null
```

- [ ] **Step 3: Update or remove the reference**

If the file exists elsewhere, update the path. If it was removed, remove the reference from the skill.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/create-service/SKILL.md
git commit -m "fix: remove broken tools/my-tool.schema.json reference from create-service skill"
```

---

## Deferred Items (Not in This Plan)

These items were identified in the audit but require separate design work:

| Item | Reason Deferred | Next Step |
|------|----------------|-----------|
| E2E: Execution domain order lifecycle scenario | Requires `design-data-flow` to map the full order path through broker-ctrl/broker-sim-adpt | Invoke `create-e2e-test` with `design-data-flow` output |
| E2E: Onboarding wizard scenario | Requires understanding of LangGraph + CopilotKit 7-phase flow | Invoke `create-e2e-test` targeting onboarding-bff |
| E2E: Standalone ledger scenario | Simpler — portfolio query + transaction history | Invoke `create-e2e-test` targeting ledger-bff |
| `revokeMandate` flow assessment | Need to decide if MANDATE_REVOKED should trigger advisory-adpt | Architecture decision needed |
| Advisory raw fetch-trigger Lambdas (5 services) | Intentional pattern — cron triggers don't fit event-processor | No action needed |
| Execution test dir conventions (broker-ctrl, broker-sim-adpt) | Low priority — tests work, just not in `test/unit/` subdir | Optional cleanup |

---

## Execution Order

Tasks 1-2 are auto-fixable and independent. Tasks 3-7 are flow spec work and can run in parallel. Tasks 8-9 are quick investigations. Recommended execution:

1. **Parallel batch 1:** Tasks 1 + 2 (auto-fix C4 + cards)
2. **Parallel batch 2:** Tasks 3 + 4 + 5 + 7 (new flow specs — independent)
3. **Sequential:** Task 6 (extends existing specs — after batch 2 to avoid conflicts)
4. **Parallel batch 3:** Tasks 8 + 9 (quick fixes)
