# WS-1 — decision-workflow-ctrl cycle-lifecycle events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** decision-workflow-ctrl emits `DECISION_CYCLE_STARTED` (at cycle start, before any DecisionPacket row exists) and `DECISION_CYCLE_FAILED` (on pre-packet failure), so advisory-bff (WS-2) can project a version-guarded `GENERATING`/`FAILED` status onto the `DecisionReadModel` row.

**Architecture:** Both signals are **SF-direct events** — fire-and-forget `putEvents` states inside the existing Step Functions definition (`Source: serviceName`, standard event-processor envelope), NOT CDC/Egress (no row exists at emit time). `DECISION_CYCLE_STARTED` is a new state spliced in right after `UnpackTriggerEnvelope`; `DECISION_CYCLE_FAILED` is a shared `Catch` handler attached to the four pre-packet states (`ParallelProjections`, `InvokePortfolioEngine`, `InvokeAdvisoryNarrative`, `AssembleDecisionPacket`) terminating in a `Fail`. The version ladder is `STARTED=0` → `DECISION_PACKET_CREATED=1` (CDC insert seeds `__version:1`, overwrites GENERATING) and `FAILED=1` (mutually exclusive with the content packet — pre-packet failure ⇒ no packet). WS-1 is independently deployable: the new events are ignored until WS-2 subscribes.

**Tech Stack:** AWS CDK (`aws-cdk-lib/aws-stepfunctions` `CustomState`/`Parallel`/`Fail`), TypeScript, Jest + `aws-cdk-lib/assertions` `Template` (parses the SF `DefinitionString` `Fn::Join` into a JSON object), Nx.

**Spec:** `docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md` §3, §10.

---

## Pre-flight facts (verified against code 2026-06-04)

- **Publication needs no `service.stack.ts` change.** `this.eventBus.grantPutEventsTo(orchestration.stateMachine)` (`service.stack.ts:180`) already grants the SF role PutEvents. SF-direct events are NOT added to the `Egress` `eventTypes` map (that is CDC-only). Cross-service routing is the **consumer's** job (WS-2 adds the two types to advisory-bff's Ingress `$or`).
- **`Source: serviceName`** is the convention every existing SF putEvents state uses (`createAgentInvocationState`, `WaitForCompliance` → `RECOMMENDATION_PROPOSED`, consumed cross-service by compliance-ctrl). Mirror it exactly so WS-2's advisory-bff Ingress `$or` accepts the new events.
- **`CustomState.addCatch(handler, props)` and `Parallel.addCatch(...)` both exist** in the installed CDK (`aws-cdk-lib@2.243.0`). `CustomState.toStateJson()` merges `renderRetryCatch()` (from `addCatch`) with any `stateJson.Catch`. Our four caught states have no `stateJson.Catch`, so no merge-warning fires.
- **`Catch` `resultPath: '$.error'` preserves `decisionId`/`tenantId`.** Default Catch `ResultPath` (`$`) would replace the whole state with `{Error,Cause}` and lose the ids the FAILED envelope needs. The four caught states all flow `decisionId`/`tenantId`/`userId`/`region` through on their input (UnpackTriggerEnvelope sets them; `ResolveTriggerAmountCents`, PE, AN, AssemblePacket all use non-`$` result paths), so the input survives into the catch output under everything except `$.error`.
- **`createDecisionPacket` seeds `__version: 1`, `status: 'PENDING'` on insert** (`decision-packet.repository.ts:47-48`). The §10 version-ladder invariant holds.
- **`WorkflowStatus` has no exhaustive `switch`/`never` consumer** (only `decision-packet.repository.ts` uses it as a type). Widening the union is safe.
- **No brittle count assertions** in `service.stack.test.ts` break: trigger rules stay 7, StateMachine stays 1, Memory strategies stay 3, no total-state count, and the `WORKFLOW_TRIGGER_*` substring guard does not match `DECISION_CYCLE_*`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `services/advisory/decision-workflow-ctrl/src/domain/models.ts` | `WorkflowStatus` union | Add `'GENERATING'`, `'FAILED'` |
| `services/advisory/decision-workflow-ctrl/src/domain/events.ts` | `DecisionWorkflowEventTypes` registry | Add `DECISION_CYCLE_STARTED`, `DECISION_CYCLE_FAILED` |
| `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` | SF definition | Add `EmitDecisionCycleStarted` state + chain splice; add `EmitDecisionCycleFailed` + `DecisionCycleFailed` (Fail) + `addCatch` on 4 states |
| `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` | SF synth assertions | New STARTED/FAILED/Catch tests; fix the existing chain-ordering assertion |
| `services/advisory/decision-workflow-ctrl/CLAUDE.md` | Service card | Document the two SF-direct events + GENERATING/FAILED statuses |

No change to `service.stack.ts` (grant + Egress already correct).

---

## Task 1: Widen `WorkflowStatus` and register the two events

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/models.ts:2-8`
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts:4-15`

- [ ] **Step 1: Widen the `WorkflowStatus` union**

In `src/domain/models.ts`, replace the union (lines 2-8) with:

```ts
/** Status of a DecisionPacket through the Step Functions workflow.
 *  GENERATING/FAILED are cycle-lifecycle statuses set by advisory-bff (WS-2)
 *  from the SF-direct DECISION_CYCLE_STARTED/FAILED events — no DecisionPacket
 *  row carries them (they describe a cycle with no packet yet). */
export type WorkflowStatus =
  | 'GENERATING'
  | 'PENDING'
  | 'AWAITING_CONFIRMATION'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED';
```

- [ ] **Step 2: Register the two event names**

In `src/domain/events.ts`, add two members to `DecisionWorkflowEventTypes` (after `MANDATE_SNAPSHOT_CREATED`, line 14). Event names are free-form branded strings (no closed suffix set):

```ts
  MANDATE_SNAPSHOT_CREATED: eventName('MANDATE_SNAPSHOT_CREATED'),
  // WS-1 (advisory-generating-failed-ux): SF-direct cycle-lifecycle signals.
  // Emitted by the state machine via putEvents (Source: serviceName), NOT CDC —
  // no DecisionPacket row exists at emit time. advisory-bff (WS-2) projects them
  // onto the DecisionReadModel row as status GENERATING (__version:0) / FAILED
  // (__version:1) via projectVersioned.
  DECISION_CYCLE_STARTED: eventName('DECISION_CYCLE_STARTED'),
  DECISION_CYCLE_FAILED: eventName('DECISION_CYCLE_FAILED'),
```

- [ ] **Step 3: Verify the types compile**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS (union widening + two added constants are purely additive; the read-model-ownership type-test is unaffected — no new typename).

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain/models.ts services/advisory/decision-workflow-ctrl/src/domain/events.ts
git commit --no-verify -m "feat(decision-workflow-ctrl): add GENERATING/FAILED status + DECISION_CYCLE_STARTED/FAILED event names

WS-1 of advisory-generating-failed-ux. Pure additions — no consumer change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Worktree commits use `--no-verify` — the pre-commit hook's nx-affected check cannot run in a symlinked worktree. Verify each commit landed with `git log --oneline -1`, never trust an echo.)

---

## Task 2: Emit `DECISION_CYCLE_STARTED` at cycle start

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` (add state ~after line 321; splice into chain at line 654-655)
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/decision-state-machine.test.ts`, inside the top-level `describe`, after the existing "Main chain ordering" block (after line 343):

```ts
  // ---- WS-1: cycle-lifecycle events (advisory-generating-failed-ux) ---------

  it('emits DECISION_CYCLE_STARTED as a fire-and-forget putEvents (GENERATING, __version 0, ResultPath DISCARD)', () => {
    const s = definition.States.EmitDecisionCycleStarted;
    expect(s).toBeDefined();
    expect(s.Type).toBe('Task');
    // fire-and-forget — NOT putEvents.waitForTaskToken
    expect(s.Resource).toBe('arn:aws:states:::events:putEvents');
    // DISCARD so decisionId/tenantId/userId/region flow through to ResolveTriggerAmountCents
    expect(s.ResultPath).toBeNull();
    const entry = s.Parameters.Entries[0];
    expect(entry.DetailType).toBe('DECISION_CYCLE_STARTED');
    expect(entry.Source).toBeDefined();
    const detail = entry.Detail;
    expect(detail.type).toBe('DECISION_CYCLE_STARTED');
    expect(detail.subject['decisionId.$']).toBe('$.decisionId');
    expect(detail.subject['tenantId.$']).toBe('$.tenantId');
    expect(detail.subject.status).toBe('GENERATING');
    expect(detail.subject.__version).toBe(0);
    expect(detail.context['tenantId.$']).toBe('$.tenantId');
    expect(detail.context['userId.$']).toBe('$.userId');
    expect(detail.context['region.$']).toBe('$.region');
  });

  it('splices EmitDecisionCycleStarted between UnpackTriggerEnvelope and ResolveTriggerAmountCents', () => {
    expect(definition.States.UnpackTriggerEnvelope.Next).toBe('EmitDecisionCycleStarted');
    expect(definition.States.EmitDecisionCycleStarted.Next).toBe('ResolveTriggerAmountCents');
  });
```

Then **fix the now-stale existing assertion** in the "wires the main chain ..." test (currently line 333):

```ts
    // BEFORE:
    // expect(definition.States.UnpackTriggerEnvelope.Next).toBe('ResolveTriggerAmountCents');
    // AFTER (the STARTED state is now spliced in between):
    expect(definition.States.UnpackTriggerEnvelope.Next).toBe('EmitDecisionCycleStarted');
    expect(definition.States.EmitDecisionCycleStarted.Next).toBe('ResolveTriggerAmountCents');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run decision-workflow-ctrl:test --testFile=test/unit/decision-state-machine.test.ts`
Expected: FAIL — `definition.States.EmitDecisionCycleStarted` is `undefined`; the spliced-chain assertions fail.

- [ ] **Step 3: Add the `EmitDecisionCycleStarted` state**

In `src/constructs/decision-state-machine.ts`, immediately **after** the `unpackTriggerEnvelope` Pass state definition (after line 321, before the `setTriggerAmountCentsFromTrigger` block), insert:

```ts
    // --- WS-1: cycle-start signal (advisory-generating-failed-ux mini-program) ---
    // Fire-and-forget putEvents announcing the cycle is GENERATING, BEFORE any
    // DecisionPacket row exists (the packet is created ~30-60s later at
    // AssembleDecisionPacket). advisory-bff (WS-2) projects this onto the
    // DecisionReadModel row as status=GENERATING (__version:0). ResultPath:null
    // (DISCARD) preserves the SF state (decisionId/tenantId/userId/region) for
    // ResolveTriggerAmountCents downstream. Source = serviceName matches every
    // other SF putEvents state (e.g. RECOMMENDATION_PROPOSED), so WS-2's
    // advisory-bff Ingress $or accepts it. __version:0 sorts below the
    // DecisionPacket CDC insert (__version:1) → a content packet cleanly
    // overwrites the GENERATING row via the version guard.
    const emitCycleStarted = new sfn.CustomState(this, 'EmitDecisionCycleStarted', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'DECISION_CYCLE_STARTED',
              Detail: {
                'id.$': 'States.UUID()',
                'type': 'DECISION_CYCLE_STARTED',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'status': 'GENERATING',
                  '__version': 0,
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
              },
            },
          ],
        },
        ResultPath: null,
      },
    });
```

- [ ] **Step 4: Splice it into the main chain**

In the same file, change the chain head (currently line 654-655):

```ts
    // BEFORE:
    // const definition = unpackTriggerEnvelope
    //   .next(amountCentsResolved)

    // AFTER:
    const definition = unpackTriggerEnvelope
      .next(emitCycleStarted)
      .next(amountCentsResolved)
```

(Leave the rest of the `.next(mergeProjections)...` chain unchanged.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx run decision-workflow-ctrl:test --testFile=test/unit/decision-state-machine.test.ts`
Expected: PASS — including the updated "wires the main chain ..." test.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit --no-verify -m "feat(decision-workflow-ctrl): emit DECISION_CYCLE_STARTED at cycle start

WS-1. Fire-and-forget putEvents (GENERATING, __version:0) spliced after
UnpackTriggerEnvelope; ResultPath DISCARD preserves SF state.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Verify: `git log --oneline -1`.

---

## Task 3: Emit `DECISION_CYCLE_FAILED` on pre-packet failure

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` (add handler + Fail near line 646; `addCatch` calls before `const definition`)
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/decision-state-machine.test.ts`, after the Task-2 tests:

```ts
  it('emits DECISION_CYCLE_FAILED via a shared handler (FAILED, __version 1) terminating in a Fail state', () => {
    const s = definition.States.EmitDecisionCycleFailed;
    expect(s).toBeDefined();
    expect(s.Type).toBe('Task');
    expect(s.Resource).toBe('arn:aws:states:::events:putEvents');
    expect(s.ResultPath).toBeNull();
    const entry = s.Parameters.Entries[0];
    expect(entry.DetailType).toBe('DECISION_CYCLE_FAILED');
    const detail = entry.Detail;
    expect(detail.type).toBe('DECISION_CYCLE_FAILED');
    // decisionId/tenantId survive because each Catch uses resultPath:'$.error'
    expect(detail.subject['decisionId.$']).toBe('$.decisionId');
    expect(detail.subject['tenantId.$']).toBe('$.tenantId');
    expect(detail.subject.status).toBe('FAILED');
    expect(detail.subject.__version).toBe(1);
    // terminates the execution as FAILED
    expect(s.Next).toBe('DecisionCycleFailed');
    expect(definition.States.DecisionCycleFailed.Type).toBe('Fail');
  });

  it('catches pre-packet failures on the 4 pre-packet states → EmitDecisionCycleFailed (States.ALL, resultPath $.error)', () => {
    for (const name of [
      'ParallelProjections',
      'InvokePortfolioEngine',
      'InvokeAdvisoryNarrative',
      'AssembleDecisionPacket',
    ]) {
      const st = definition.States[name];
      expect(Array.isArray(st.Catch)).toBe(true);
      const cat = st.Catch.find((c: any) => c.Next === 'EmitDecisionCycleFailed');
      expect(cat).toBeDefined();
      expect(cat.ErrorEquals).toContain('States.ALL');
      // resultPath preserves the original state (decisionId/tenantId) — NOT default '$'
      expect(cat.ResultPath).toBe('$.error');
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run decision-workflow-ctrl:test --testFile=test/unit/decision-state-machine.test.ts`
Expected: FAIL — `EmitDecisionCycleFailed` undefined; no `Catch` on the four states.

- [ ] **Step 3: Add the shared handler + Fail terminal**

In `src/constructs/decision-state-machine.ts`, immediately **before** the `// --- Wire the chain ---` comment (before line 646), insert:

```ts
    // --- WS-1: pre-packet failure signal ---
    // Shared Catch handler for the four PRE-PACKET states (ParallelProjections,
    // InvokePortfolioEngine, InvokeAdvisoryNarrative, AssembleDecisionPacket).
    // Each addCatch uses resultPath:'$.error' so the original SF state
    // (decisionId/tenantId/userId/region) is preserved for this envelope and the
    // error object is nested under $.error (intentionally not forwarded onto the
    // bus). __version:1 — a pre-packet failure means NO DecisionPacket row was
    // created, so this is mutually exclusive with a content DECISION_PACKET_CREATED
    // (also v1); the v1 overlap never materialises. Catchable failures only:
    // agent SendTaskFailure / States.Timeout / Lambda errors. Uncatchable
    // States.Runtime emits nothing here (feedback_states_runtime_uncatchable) —
    // WS-3's UI staleness guard covers those. Source = serviceName, same as STARTED.
    const emitCycleFailed = new sfn.CustomState(this, 'EmitDecisionCycleFailed', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'DECISION_CYCLE_FAILED',
              Detail: {
                'id.$': 'States.UUID()',
                'type': 'DECISION_CYCLE_FAILED',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'status': 'FAILED',
                  '__version': 1,
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
              },
            },
          ],
        },
        ResultPath: null,
      },
    });
    const decisionCycleFailed = new sfn.Fail(this, 'DecisionCycleFailed', {
      comment: 'Pre-packet decision-cycle failure — DECISION_CYCLE_FAILED emitted',
    });
    emitCycleFailed.next(decisionCycleFailed);

    // Attach the shared handler to every pre-packet state. One handler instance
    // referenced by four Catch clauses — CDK incorporates it into the graph once.
    const prePacketCatch: sfn.CatchProps = {
      errors: ['States.ALL'],
      resultPath: '$.error',
    };
    parallelProjections.addCatch(emitCycleFailed, prePacketCatch);
    invokePortfolioEngine.addCatch(emitCycleFailed, prePacketCatch);
    invokeAdvisoryNarrative.addCatch(emitCycleFailed, prePacketCatch);
    assemblePacket.addCatch(emitCycleFailed, prePacketCatch);
```

Note: `sfn.CatchProps` and `sfn` are already imported (`import * as sfn from 'aws-cdk-lib/aws-stepfunctions'`, line 5). `parallelProjections`, `invokePortfolioEngine`, `invokeAdvisoryNarrative`, `assemblePacket` are all already in scope at this point in the constructor.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx run decision-workflow-ctrl:test --testFile=test/unit/decision-state-machine.test.ts`
Expected: PASS. If CDK emits a "multipleCatchSources" warning, ignore it (these states have no `stateJson.Catch`, so the warning does not apply and the assertion still passes). If synth throws `There is already a Construct with name 'EmitDecisionCycleFailed'`, that means a non-shared handler was created per state — keep the single shared instance as written above.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit --no-verify -m "feat(decision-workflow-ctrl): emit DECISION_CYCLE_FAILED on pre-packet failure

WS-1. Shared Catch handler (States.ALL, resultPath \$.error) on the four
pre-packet states → fire-and-forget putEvents (FAILED, __version:1) → Fail.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Verify: `git log --oneline -1`.

---

## Task 4: Full unit + typecheck + lint gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full DWC unit suite**

Run: `pnpm nx run decision-workflow-ctrl:test`
Expected: PASS — all of `decision-state-machine.test.ts` plus `service.stack.test.ts` (unaffected: no new EB Rules, trigger count still 7, StateMachine still 1, no `WORKFLOW_TRIGGER_*` substring collision).

- [ ] **Step 2: Typecheck (read-model-ownership type-test included)**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS — no new typename; `DecisionPacket` ownership registration unchanged.

- [ ] **Step 3: Lint**

Run: `pnpm nx run decision-workflow-ctrl:lint`
Expected: PASS.

- [ ] **Step 4: Affected sweep (matches the /backlog-next 6.2 gate)**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS. (No code outside decision-workflow-ctrl changed, but the two new event-name exports widen the `./events` subpath — confirm no advisory consumer that imports `DecisionWorkflowEventTypes` breaks. They will not: additions only.)

- [ ] **Step 5: No commit** (verification task — nothing to stage).

---

## Task 5: Update the service card (doc derivation)

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md`

- [ ] **Step 1: Document the two SF-direct events**

In `services/advisory/decision-workflow-ctrl/CLAUDE.md`, under `## Event Types (domain/events.ts)`, extend the `DecisionWorkflowEventTypes` line to include the two new names and add a short note:

```md
- DecisionWorkflowEventTypes (outbound + routed): DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, DECISION_FEEDBACK, DECISION_WORKFLOW_FAILED, AGENT_OUTPUT_CREATED, AGENT_OUTPUT_UPDATED, MANDATE_SNAPSHOT_CREATED, DECISION_CYCLE_STARTED, DECISION_CYCLE_FAILED
  Note: DECISION_CYCLE_STARTED / DECISION_CYCLE_FAILED are SF-DIRECT events (putEvents from the state machine, Source=serviceName), NOT CDC/Egress — no DecisionPacket row exists at emit time. STARTED fires after UnpackTriggerEnvelope (GENERATING, __version:0); FAILED fires from a shared Catch on the 4 pre-packet states (FAILED, __version:1) → Fail. advisory-bff (WS-1's WS-2 consumer) projects them onto the DecisionReadModel row. Uncatchable States.Runtime emits no FAILED (handled by the advisory-mfe staleness guard, WS-3).
```

- [ ] **Step 2: Note GENERATING/FAILED in the status model**

Under `## Orchestration ...`, add a one-line note that `WorkflowStatus` now includes `GENERATING`/`FAILED` (cycle-lifecycle statuses, set by advisory-bff from the SF-direct events, never written onto a DecisionPacket row by DWC itself).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit --no-verify -m "docs(decision-workflow-ctrl): document DECISION_CYCLE_STARTED/FAILED SF-direct events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Deploy + live synthetic validation

**Files:** none (deploy + validation — the workstream's validation gate)

> Dev-account ops (account 771924376645) are pre-authorized; no confirmation needed. This task is also covered by the `/backlog-next` closing phase 6.3/6.4.

- [ ] **Step 1: Deploy decision-workflow-ctrl to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl 2>&1 | tee /tmp/dwc-ws1-deploy.log`
Expected: deploy completes; the SF `DefinitionString` updates with `EmitDecisionCycleStarted` + the `Catch` clauses.

- [ ] **Step 2: Validate `DECISION_CYCLE_STARTED` emits (every execution does)**

Start a synthetic SF execution against the deployed dev state machine with a minimal valid trigger envelope (a `DEPOSIT_DETECTED`-shaped detail carrying `context.tenantId/userId/region` and `subject.tenantId`), e.g. via:

```bash
AWS_PROFILE=nestfolio-dev aws stepfunctions start-execution \
  --state-machine-arn <dev-decision-workflow-ctrl SM arn> \
  --input '{"id":"ws1-smoke-1","type":"DEPOSIT_DETECTED","timestamp":"2026-06-04T00:00:00Z","subject":{"tenantId":"e2e-ws1","amountCents":100000},"context":{"tenantId":"e2e-ws1","userId":"ws1-user","region":"us-east-1"}}'
```

Then confirm `DECISION_CYCLE_STARTED` was published — check the execution history for the `EmitDecisionCycleStarted` `TaskSucceeded`, and/or an advisoryBus consumer / a temporary CloudWatch EventBridge rule. Resolve the SM arn with:

```bash
AWS_PROFILE=nestfolio-dev aws stepfunctions list-state-machines \
  --query "stateMachines[?contains(name,'dev-decision-workflow-ctrl')].stateMachineArn" --output text
```

Expected: `EmitDecisionCycleStarted` runs first and succeeds; subject `{status:GENERATING, __version:0, decisionId, tenantId}`.

- [ ] **Step 3: Validate `DECISION_CYCLE_FAILED` emits on a forced pre-packet failure**

Per `feedback_states_runtime_uncatchable` — e2e/normal runs do NOT prove a Catch fires; only a synthetic forced failure does. Force a **catchable** failure on a pre-packet state by failing the PortfolioEngine task token:

1. Start an execution (as Step 2). Wait until it reaches `InvokePortfolioEngine` (a `putEvents.waitForTaskToken` state).
2. Read the task token from the execution history:

```bash
AWS_PROFILE=nestfolio-dev aws stepfunctions get-execution-history \
  --execution-arn <execution-arn> --reverse-order --max-results 20 \
  --query "events[?taskSubmittedEventDetails || taskScheduledEventDetails]"
```

   (The token is on the `TaskScheduled`/`taskScheduledEventDetails` for the `events:putEvents.waitForTaskToken` resource — or capture it from the emitted `CONSTRUCT_PORTFOLIO` event payload `subject.taskToken`.)
3. Fail the token:

```bash
AWS_PROFILE=nestfolio-dev aws stepfunctions send-task-failure \
  --task-token '<token>' --error 'WS1SyntheticFailure' --cause 'forced pre-packet failure to prove DECISION_CYCLE_FAILED Catch'
```

Expected: `InvokePortfolioEngine` fails → the shared `Catch` routes to `EmitDecisionCycleFailed` → `DECISION_CYCLE_FAILED` published (subject `{status:FAILED, __version:1, decisionId, tenantId}`) → execution ends in the `DecisionCycleFailed` Fail state. Confirm via `get-execution-history` (look for `EmitDecisionCycleFailed` `TaskSucceeded` then `ExecutionFailed`).

- [ ] **Step 4: Record evidence**

Capture: deploy log line, the two execution ARNs, the `EmitDecisionCycleStarted` success event, and the `EmitDecisionCycleFailed` success + `DecisionCycleFailed` terminal. These populate the backlog `validation_gate:` at ship.

- [ ] **Step 5: No commit** (validation only).

---

## Self-review

**1. Spec coverage (§3, §10):**
- §3.1 `WorkflowStatus += GENERATING|FAILED` → Task 1 Step 1. ✓
- §3.2 new event names → Task 1 Step 2. ✓
- §3.3 STARTED fire-and-forget after UnpackTriggerEnvelope (`__version:0`, GENERATING, standard envelope, Source convention) → Task 2. ✓
- §3.3 FAILED Catch on ParallelProjections/PE/AN/AssemblePacket (`__version:1`, FAILED) → terminate → Task 3. ✓
- §3.3 uncatchable States.Runtime documented as out-of-scope (UI guard, WS-3) → inline comments Task 3 Step 3 + Task 5. ✓
- §3.4 publication mirrors existing SF events (Source=serviceName, no Egress/grant change) → pre-flight facts + Task 2/3 (no service.stack.ts change). ✓
- §10 verify DecisionPacket CDC `__version:1` on insert → confirmed in pre-flight (repository:48); ladder asserted in tests (STARTED 0 / FAILED 1). ✓
- §10 "FAILED and content-CREATE mutually exclusive" → documented in Task 3 handler comment. ✓
- Out of scope (WS-2 projection, WS-3 UI, WS-4 dashboard, post-packet failures) → untouched. ✓

**2. Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**3. Type/name consistency:** state IDs `EmitDecisionCycleStarted`, `EmitDecisionCycleFailed`, `DecisionCycleFailed` used identically in construct + tests; event names `DECISION_CYCLE_STARTED`/`DECISION_CYCLE_FAILED` consistent across events.ts, construct DetailType, tests, and CLAUDE.md; `prePacketCatch` `resultPath:'$.error'` matches the test assertion `cat.ResultPath === '$.error'`; `ResultPath: null` matches `expect(s.ResultPath).toBeNull()`. ✓

---

## Out of scope (mirror of backlog frontmatter)

- advisory-bff projection of GENERATING/FAILED onto DecisionReadModel (WS-2).
- advisory-mfe UI rendering + staleness guard + e2e rewrite (WS-3).
- dashboard generating/failed reflection + dashboard e2e retarget (WS-4).
- post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses).
- changing the DecisionPacket CDC `__version` emission (WS-1 only verifies it already seeds `__version:1`).
- uncatchable `States.Runtime` failures emitting FAILED (WS-3 UI staleness guard; documented limitation only).
