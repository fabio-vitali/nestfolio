# Advisory Pipeline Consolidation — Design

**Date:** 2026-04-30
**Workstream:** System architecture docs (Spec 2 of 3)
**Predecessor:** `docs/superpowers/specs/2026-04-30-system-architecture-docs-foundation-design.md` (Spec 1 — shipped)
**Successors:** Spec 3 (onboarding agent reliability), §21 OQ #11 (locate missing originating specs)
**Branch:** changes commit directly to `main` (per workstream convention)

---

## 1. Goal

Retire the legacy advisory pipeline so the advisory data plane is single-sourced through `decision-workflow-ctrl`, and align the AgentCore Memory write/read contract so the four canonical agents' outputs round-trip through Memory as designed.

The end state is the architecture already documented in `docs/architecture/SYSTEM-ARCHITECTURE.md` §7 + §10 + §17. Today the documentation is forward-looking — §7.1, §10.1, §17.1 carry "Architectural Evolution" callouts that name advisory-ctrl as transitional. Spec 2 makes the code match the documented contract and rewrites those three callouts to "resolved" status.

## 2. Non-goals

- Wiring up control-plane producers (model lifecycle, incidents, budgets, reasoning tier). Renounced — see §3.
- Spec 3 (onboarding agent reliability). Independent.
- §21 OQ #11 (missing 2026-03-18 + 2026-03-26 originating specs). Independent.
- Any change to the four canonical agent services (investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl). They already use `libs/agent-orchestrator` correctly; the Memory client fix is library-internal.

## 3. Scope decision — full removal of advisory-ctrl

The original scope as framed in §7.1 + §17.1 was "delete the legacy 6-agent subtree, fix Memory, repurpose advisory-ctrl as the control plane." During brainstorming we expanded scope: **the control-plane responsibility is renounced**, and with both data-plane and control-plane scope removed, advisory-ctrl has no remaining purpose. The entire Nx project is deleted in this spec.

Justification:

| Responsibility | Currently in advisory-ctrl | Already covered elsewhere |
|---|---|---|
| Trigger ingestion (`MANDATE_CREATED`, `GOAL_*`, `RISK_PROFILE_*`, `OPERATING_MODE_CHANGED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_*`, `DEPOSIT_DETECTED`) | `src/handlers/event-listener.ts:113-125` invokes the legacy 6-agent runtime | `decision-workflow-ctrl/src/handlers/event-listener.ts` (TriggerIngress) materializes a WorkflowTrigger row; CDC starts the SF that orchestrates the canonical 4 agents |
| Compliance callback handling (`DECISION_APPROVED` / `DECISION_BLOCKED`) | `src/handlers/event-listener.ts:127-130` updates DecisionPacket row | `decision-workflow-ctrl/src/handlers/sfn-callback.ts` resumes the SF with `SendTaskSuccess` |
| User response handling (`USER_CONFIRMED` / `USER_REJECTED`) | `src/handlers/event-listener.ts:132-135` updates DecisionPacket row | `decision-workflow-ctrl/src/handlers/sfn-callback.ts` resumes the SF |
| `DecisionPacket` row materialization → CDC → `DECISION_PACKET_CREATED` | `src/service.stack.ts:67-71` (Egress eventTypes mapping) | `decision-workflow-ctrl` Egress (and `assemble-packet.ts:75-86` writes the row in the canonical store) |
| Multi-agent decision lifecycle (LangGraph orchestration) | `agents/decision-lifecycle/{graph,server}.ts` + `src/agents/{config,fallbacks,validation,state,prompts/}` | The 4 canonical *-ctrl services each host their own agent + AgentCore runtime |
| Tools for the legacy agent (`portfolio-lookup`, `market-data`, `instrument-universe`, `event-publisher`) | `src/handlers/tools/*.ts` + `src/tools/*-schema.json` | The 4 canonical agents have their own tools |
| Control plane (model lifecycle, incidents, budgets, reasoning tier) | Typed in `src/domain/events.ts` but no producer wired | **Renounced** — see §4 |

There is no responsibility left for advisory-ctrl after this consolidation.

## 4. Renunciation of the control-plane scope

The 19 control-plane event types currently typed in `services/advisory/advisory-ctrl/src/domain/events.ts` (model lifecycle, incidents, budgets, reasoning tier, operator/health, delivery) describe a feature surface that has never had producers wired. The original §7 design positioned advisory-ctrl as the future home for this surface. We are renouncing the feature: the control plane will not be built as currently scoped, and the typed-but-unwired event names in `events.ts` should not be preserved in a stub project just to keep the names in TypeScript.

Concretely:

- **Delete** all 19 control-plane event types along with the rest of `events.ts` when the project is removed.
- **Delete** all consumer references. Verified by `Grep` over `services/` + `apps/` + `libs/`: zero handlers subscribe to any of the 19. They are name-only definitions.
- **Update** SYSTEM-ARCHITECTURE.md §7 + §9 + §17 to reflect that advisory-ctrl no longer exists. The control-plane feature surface remains a future possibility but is no longer represented in the typed event space.

If the control plane is ever revived, the events get re-typed in whatever service ends up owning them. Re-typing one line per event is cheap; carrying the contract in a dead project is misleading.

## 5. Architecture (the "after" state)

```
{trigger event} ─► decision-workflow-ctrl (TriggerIngress)
                  │  materializes WorkflowTrigger row
                  │  CDC → WORKFLOW_TRIGGER_CREATED
                  │
                  ▼  EB Rule starts SF
              DecisionStateMachine
                  │
                  ├─ wave 1 (parallel SF tasks): investor-profile-ctrl + market-intelligence-ctrl + portfolio-engine-ctrl
                  ├─ wave 2 (after wave 1):     advisory-narrative-ctrl
                  ├─ AssemblePacket Lambda (reads agent outputs from Memory namespace, writes DecisionPacket row)
                  │  CDC → DECISION_PACKET_CREATED  ◄── single canonical emitter
                  │
                  ├─ WaitForCompliance task token  ──► compliance-ctrl (subscribed to DECISION_PACKET_CREATED)
                  │      ◄── DECISION_APPROVED / DECISION_BLOCKED resumes SF
                  │
                  ├─ WaitForUserConfirmation task token (L2 only)  ──► UI prompt
                  │      ◄── USER_CONFIRMED / USER_REJECTED resumes SF
                  │
                  └─ EmitDecisionFinalized
```

advisory-ctrl is gone. The Intelligence layer in §7 is exactly four services. The Memory contract is symmetric (write a record, list records).

## 6. Teardown manifest

### 6.1 Deletions

| Path | Why |
|---|---|
| `services/advisory/advisory-ctrl/` (entire Nx project — `src/`, `agents/`, `test/`, `project.json`, `jest.config.js`, `jest.integration.config.js`, `CLAUDE.md`) | Service has no remaining responsibility (§3) |
| Stack mount in `infrastructure/bin/app.ts` (or wherever `AdvisoryCtrlStack` is composed) | Stops synthesizing/deploying the stack |
| `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — only the advisory-ctrl `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED` trap | The legacy AgentCore runtime no longer exists. Other agent traps (4 canonical services) remain |
| `tsconfig.base.json` path mapping for `@nestfolio/advisory-ctrl/*` | Symbol no longer resolvable |
| `pnpm-workspace.yaml` reference if advisory-ctrl is enumerated explicitly (likely glob-matched, verify) | Project removed |

### 6.2 Edits — import path swaps

advisory-bff and the e2e suite import names that survive in `decision-workflow-ctrl`'s event types:

| File | Edit |
|---|---|
| `services/advisory/advisory-bff/src/handlers/event-listener.ts` | `@nestfolio/advisory-ctrl/events` → `@nestfolio/decision-workflow-ctrl/events` |
| `services/advisory/advisory-bff/src/service.stack.ts` | same |
| `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts` | same |
| `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts` | same |
| `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts` | same |
| `services/advisory/advisory-bff/test/unit/transforms/decision-packet-created.test.ts` | same |
| `services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts` | same |
| `apps/e2e-feature-tests/src/helpers/fixtures.ts` | same |
| `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts` | same |

The names — `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED`, `USER_CONFIRMATION_REQUESTED` — are already defined in `services/advisory/decision-workflow-ctrl/src/domain/events.ts`. No new types added.

### 6.3 Edits — compliance-ctrl trigger swap

| File | Edit |
|---|---|
| `services/advisory/compliance-ctrl/src/handlers/event-listener.ts:202` | Drop `AdvisoryCtrlEventTypes.RECOMMENDATION_PROPOSED` handler. Replace with `DecisionWorkflowEventTypes.DECISION_PACKET_CREATED` handler. The handler body keeps the same compliance-evaluation logic; only the event-type key changes |
| `services/advisory/compliance-ctrl/src/service.stack.ts:16` | Same swap in the Ingress `eventTypes` array |
| `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts` | Drop `RECOMMENDATION_PROPOSED` assertion. Add `DECISION_PACKET_CREATED` assertion |

The `DECISION_PACKET_CREATED` payload carries the same business inputs compliance needs (proposed trades, current positions, portfolio value, risk score) — see `decision-workflow-ctrl/src/handlers/assemble-packet.ts:75-86` for the row shape. No payload schema changes required.

### 6.4 Documents — leave alone

Historical specs and plans that reference `AdvisoryCtrlEventTypes` describe the state at the time they were written. They stay as-is:

- `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`
- `docs/superpowers/plans/2026-04-11-e2e-feature-tests.md`
- `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md`
- `docs/superpowers/plans/2026-04-09-typed-event-names.md`

If a future reader could be misled, add a one-line "Superseded by Spec 2 (2026-04-30)" header. Otherwise leave alone.

## 7. AgentCore Memory client redesign

Edit `libs/agent-orchestrator/src/memory/memory-client.ts`. The exported interface (`MemoryClient`, `DecisionSession`, `MemoryRecord`, `createMemoryClient`, `MemoryClientConfig`) is unchanged. The no-op client (`libs/agent-orchestrator/src/memory/no-op-client.ts`) is unchanged.

Implementation switches:

### 7.1 `writeAgentOutput`

Before (`memory-client.ts:36-53`):

```typescript
await client.send(
  new CreateEventCommand({
    memoryId: config.memoryId,
    actorId: tenantId,
    sessionId: decisionId,
    eventTimestamp: new Date(),
    payload: [{ conversational: { content: { text: JSON.stringify(output) }, role: 'ASSISTANT' } }],
  })
);
```

After:

```typescript
const namespace = `/${config.serviceName}/${tenantId}/decisions/${decisionId}`;
await client.send(
  new BatchCreateMemoryRecordsCommand({
    memoryId: config.memoryId,
    records: [
      {
        namespace,
        content: { text: JSON.stringify(output) },
        // memoryRecordId omitted → server-assigned
      },
    ],
  })
);
```

The write now lands in the same namespace the read searches. `serviceName` is configured per consumer (each of the 4 canonical agent services passes its own).

### 7.2 `readUpstreamOutput`

Before (`memory-client.ts:55-65`):

```typescript
const namespace = `/${upstreamService}/${tenantId}/decisions/${decisionId}`;
const resp = await client.send(
  new RetrieveMemoryRecordsCommand({
    memoryId: config.memoryId,
    namespace,
    searchCriteria: { searchQuery: 'agent output', topK: 5 },
  })
);
```

After:

```typescript
const namespace = `/${upstreamService}/${tenantId}/decisions/${decisionId}`;
const resp = await client.send(
  new ListMemoryRecordsCommand({ memoryId: config.memoryId, namespace })
);
```

Direct list — no semantic-search misuse. Returns all records in the namespace, deterministic and complete. Closes §21 OQ #7.

### 7.3 `searchLongTermMemory` + `searchTenantMemory`

Unchanged. `RetrieveMemoryRecordsCommand` with a `searchQuery` is correct over the long-term namespaces (`preferences`, `signals`, `rationale`) where Bedrock extraction strategies are attached and semantic recall is the right semantic.

### 7.4 `mapRecord`

Unchanged. Both `RetrieveMemoryRecordsCommand` and `ListMemoryRecordsCommand` return `memoryRecordSummaries` with the same `content.text` / `score` / `memoryRecordId` shape.

### 7.5 AssemblePacket defence-in-depth

`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` — leave the `Promise.all(UPSTREAM_SERVICES.map(svc => session.readUpstreamOutput(svc)))` call at line 33-35 in place. Once the Memory client is fixed, this read returns real data and the placeholder fallback at line 64-67 becomes a true degraded-path defence rather than the always-hit primary path. The comment block at lines 56-67 should be updated to reflect this (the namespace-mismatch explanation is no longer the failure mode).

## 8. Tests

### 8.1 New tests

`libs/agent-orchestrator/test/memory-client.test.ts` — unit test using `aws-sdk-client-mock`:

- `writeAgentOutput` issues `BatchCreateMemoryRecordsCommand` with `records[0].namespace === /{serviceName}/{tenantId}/decisions/{decisionId}` and `records[0].content.text === JSON.stringify(output)`.
- `readUpstreamOutput(upstreamService)` issues `ListMemoryRecordsCommand` with `namespace === /{upstreamService}/{tenantId}/decisions/{decisionId}` (note: scoped to the upstream service, not the consumer).
- Round-trip: stub `ListMemoryRecordsCommand` to return a record, assert `readUpstreamOutput` returns it parsed via `mapRecord`.
- `searchLongTermMemory` still issues `RetrieveMemoryRecordsCommand` with the searchQuery.

### 8.2 Updated tests

- `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts` — keep; the `Promise.all` over `UPSTREAM_SERVICES` composition is unchanged.
- `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts` — drop `RECOMMENDATION_PROPOSED` handler assertion; add `DECISION_PACKET_CREATED` handler assertion.
- `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts` + transforms tests — update import paths only; behaviour unchanged.
- `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts` — update import path; assertion unchanged.

### 8.3 Deleted tests

All advisory-ctrl tests (unit + integration) — deleted with the project. This includes `decision-lifecycle.service.test.ts`, `decision.repository.test.ts`, `graph.test.ts`, `agents/*.test.ts`, the four `tools-*.test.ts` files, `event-listener.test.ts`, `service.stack.test.ts`, `tools-event-publisher.test.ts`, and `integration/advisory-ctrl.integration.test.ts`.

### 8.4 Regression assertions

- E2E happy path (`apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts` and the broader 13-scenario suite) — passing on `main` today, must still pass after Spec 2. This is the regression test for the dual-emitter race resolution: only one producer of `DECISION_PACKET_CREATED` left, no race possible.
- compliance-ctrl integration test — must still emit `DECISION_APPROVED` / `DECISION_BLOCKED` end-to-end from a `DECISION_PACKET_CREATED` ingest.
- advisory-bff integration test — projection still receives `DECISION_PACKET_CREATED` from the (now sole) decision-workflow-ctrl emitter.

## 9. Deploy ordering

Sandbox account 771924376645, region us-east-1, prefix `dev`.

Three deploy steps:

1. `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=compliance-ctrl,advisory-bff`
   - Deploys the trigger swap and import migration. compliance-ctrl now subscribes to `DECISION_PACKET_CREATED` from decision-workflow-ctrl. advisory-bff projection unchanged at the wire (event names identical) but the bundle hash changes because the import path changed. decision-workflow-ctrl has no code diff and does not need redeployment.
2. Remove advisory-ctrl from `infrastructure/bin/app.ts` and re-synth → next deploy of the full app set will skip advisory-ctrl.
3. **Explicit destroy** (the only destructive AWS operation in this spec — confirm before running): `cdk destroy NestfolioAdvisoryCtrlStack-dev` (or whatever the stack id is). CDK does not auto-destroy stacks when their construct is removed from the app composition.

Order matters in principle: step 1 attaches compliance-ctrl to the new signal before step 3 takes the legacy producer offline. In practice the legacy producer hasn't been operational, so the ordering is defence-in-depth rather than load-bearing.

## 10. Documentation rotation

### 10.1 `docs/architecture/SYSTEM-ARCHITECTURE.md`

| Section | Edit |
|---|---|
| §7 main paragraph | No change — already says "4 agent-ctrl services" |
| §7.1 "Architectural Evolution — 6→4 advisory agent decomposition" | Rewrite from "in progress, advisory-ctrl is the legacy 5th service" to "**Resolved 2026-04-30 (Spec 2)**: legacy 6-agent advisory-ctrl removed. Intelligence layer is exactly 4 services. Brief historical note on the drivers (per-agent Memory locality, observability, runtime independence)." |
| §10.1 "Architectural Evolution — Dual `DECISION_PACKET_CREATED` emitters" | Rewrite to "**Resolved 2026-04-30 (Spec 2)**: legacy emitter (advisory-ctrl CDC) removed. decision-workflow-ctrl AssemblePacket is the sole canonical emitter." |
| §13 Decision Lifecycle diagram | Verify the "(canonical emission point, §10.1)" footnote still reads correctly |
| §17.1 "Architectural Evolution — Current implementation diverges from contract" | Rewrite to "**Resolved 2026-04-30 (Spec 2)**: `writeAgentOutput` uses `BatchCreateMemoryRecordsCommand`, `readUpstreamOutput` uses `ListMemoryRecordsCommand`. Symmetric write/read against `decisions/{decisionId}` namespace." |
| §21 OQ #3 (AgentCore Memory namespace mismatch) | Close. Replace with one-liner: "Closed 2026-04-30 by Spec 2." |
| §21 OQ #7 (`decisions/{decisionId}` extraction strategy) | Close. "Closed 2026-04-30 by Spec 2: direct list-records replaces semantic-search read; no extraction strategy needed." |
| §23 Related Documents | Leave the "(date-anchored, not on disk) 2026-03-18 AgentCore Memory design" line — Spec 3 §21 OQ #11 owns that recovery |

### 10.2 `docs/architecture/SERVICE-INVENTORY.md`

- Remove the advisory-ctrl entry entirely.
- Decrement Advisory domain total by 1.
- Total: 33 → 32 services.
- Re-tally Health labels — advisory-bff, decision-workflow-ctrl, compliance-ctrl, the 4 canonical agent services should retain their existing Health.

### 10.3 User auto-memory (`MEMORY.md` + topic files)

- `MEMORY.md` Architecture line: `33 services total` → `32 services total`.
- `MEMORY.md` Architecture line: `Advisory decision cycle: 5 services` → `4 services`.
- `MEMORY.md` Recently Completed Work: add Spec 2 entry with SHA range and pointer to a new topic file.
- New topic file `project_advisory_pipeline_consolidation.md` with the long-form story (renunciation, dual-emitter resolution, Memory namespace fix, deploy ordering).
- `project_system_architecture_docs.md`: append Spec 2 ship note.

### 10.4 `CLAUDE.md`

No edits. The "Canonical Architecture References" block already points at the two canonical docs that get updated in §10.1 + §10.2. The "System Model" section does not enumerate service count.

## 11. Risk + rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| compliance-ctrl integration test fails because `DECISION_PACKET_CREATED` payload shape differs from what handler expects | Low | Verified payload at `assemble-packet.ts:75-86`. Add unit-test assertion early in the plan |
| advisory-bff projection regression because import path swap reorders or shadows a name | Very low | Names are identical; TypeScript compile catches any mismatch |
| Memory client unit test passes but live AgentCore runtime returns no records | Low | Smoke test in dev — invoke a 4-agent pipeline end-to-end, assert AssemblePacket logs show non-empty `readUpstreamOutput` results |
| `cdk destroy` of advisory-ctrl deletes the State table with in-flight data | Negligible | Dev is disposable per `feedback_no_deprecation.md`. Confirm no cross-service reads of advisory-ctrl's State table — `Grep` search confirms zero |
| Some import path missed in the swap | Low | Plan step explicitly runs `Grep "@nestfolio/advisory-ctrl"` after edits, expecting zero matches |
| Build-time path mapping for `@nestfolio/advisory-ctrl/*` left behind | Low | Plan step removes from `tsconfig.base.json`; affected nx graph build catches |

Rollback: revert the commit series. Dev redeploy of advisory-ctrl from the prior SHA restores the legacy stack. No data migration concerns (dev disposable).

## 12. Out-of-scope items (explicit non-goals)

- Migrating the four canonical agent services off direct `@nestfolio/agent-orchestrator` Memory client usage — they're already using it correctly.
- Touching the `searchLongTermMemory` / `searchTenantMemory` semantics — they remain `RetrieveMemoryRecordsCommand` with a `searchQuery`, which is correct for long-term namespaces with extraction strategies attached.
- Adding integration tests for the AgentCore Memory client against a live AgentCore Memory resource. The unit tests with `aws-sdk-client-mock` cover the contract; integration coverage comes from the existing E2E suite.
- Resolving the broader open question in `project_decision_workflow_stuck.md` (SF stuck at WaitForCompliance). That issue is independent — compliance-ctrl trigger swap may help or may not; if SF is still stuck after Spec 2 ships, it's a separate investigation.

## 13. Success criteria

1. `find services/advisory/advisory-ctrl -type d` returns nothing.
2. `Grep "@nestfolio/advisory-ctrl"` over the entire workspace (excluding `docs/superpowers/`) returns zero matches.
3. `Grep "AdvisoryCtrlEventTypes"` over the entire workspace (excluding `docs/superpowers/` and `MEMORY.md` history) returns zero matches.
4. `Grep "RECOMMENDATION_PROPOSED"` returns only references in legacy specs/plans under `docs/superpowers/`. Zero references in production code.
5. `pnpm nx run-many -t build,test,lint` — green for affected projects.
6. `pnpm nx run e2e-feature-tests:test-e2e-features` — passes scenarios touching the advisory pipeline.
7. SYSTEM-ARCHITECTURE.md §7.1 + §10.1 + §17.1 read "Resolved 2026-04-30 (Spec 2)".
8. SYSTEM-ARCHITECTURE.md §21 OQ #3 + #7 closed.
9. SERVICE-INVENTORY.md shows 32 services total; advisory-ctrl entry absent.
10. `MEMORY.md` updated: 32 services, 4-service decision cycle, Spec 2 ship note.
11. Sandbox dev deployment: a single decision-cycle end-to-end produces exactly one `DECISION_PACKET_CREATED` event on advisoryBus (not two), confirmed by CloudWatch Logs Insights query over `/aws/lambda/dev-advisory-bff-event-listener` filtered by a single `decisionId` — exactly one matching invocation expected per decision.
12. `cdk destroy NestfolioAdvisoryCtrlStack-dev` returns success.
