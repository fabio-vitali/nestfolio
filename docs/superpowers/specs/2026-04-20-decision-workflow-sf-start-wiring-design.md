# decision-workflow-ctrl SF-start wiring — design

**Date:** 2026-04-20
**Status:** Approved — ready for plan drafting
**Delegated from:** `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md` (Phase 3.5, superseded)
**Originating diagnosis:** `memory/project_pipeline_trigger_gap.md`

## Background

`dev-decision-workflow-ctrl-decisionstatemachine` has never executed in sandbox (`aws stepfunctions list-executions` returns `[]`). `GENERATE_NARRATIVE` is emitted only from this state machine, and the four advisory LangGraph agents (investor-profile, portfolio-engine, market-intelligence, advisory-narrative) are invoked via `waitForTaskToken` callbacks from the SF's task states. If the SF never runs, no agent is invoked via the live path, and e2e contract assertions on agent traces cannot land.

Two distinct architectural defects were diagnosed on 2026-04-20:

### Defect 1 — Ingress Lambdas + EB rules absent from the deployed stack

- `aws events list-rules --event-bus-name dev-advisory-event-bus --name-prefix dev-decision-workflow-ctrl` → `{"Rules": []}`.
- Deployed log groups: only `AssemblePacket` + `EgressPublisher`; no `IngressHandler*` log groups.
- CloudFormation stack `dev-decision-workflow-ctrl` is `UPDATE_COMPLETE` as of 2026-04-17 07:48 UTC.
- Code declares `TriggerIngress` + `CallbackIngress` via `new Ingress(...)` (`service.stack.ts:130-144`), but neither is present in AWS.

Triage decision (2026-04-20): **assume stale deploy and redeploy first.** If the redeploy still fails to produce both Ingress handlers + their EB rules, the fault is a `cdk-constructs` `Ingress` bug when two instances share the same `State`, and a separate plan handles it.

### Defect 2 — No `StartExecution` wiring for the SF

This is the bigger defect.

- `grep -rn "startExecution\|grantStartExecution\|StartExecution" services/advisory/decision-workflow-ctrl/` → no matches.
- `service.stack.ts:120-125` instantiates `Orchestration` with `triggers: []` and the comment *"No direct EB trigger — SF started via CDC chain"*.
- `event-listener.ts` comment claims *"CDK EventBridge rule starts Step Functions when CDC publishes `WORKFLOW_TRIGGER_CREATED`"* — but no such EB-rule-to-SF target exists anywhere in the stack, and no Lambda calls `sfn:StartExecution` either.
- `flows/advisory-cycle.flow.yaml` lines 30-32 attribute the start to *"the `Orchestration` construct's internal wiring"* — the `Orchestration` construct has no such internal wiring (only `triggers: EventName[]` → direct EB Rule → `SfnStateMachine`, or `executionName` + `grantStartExecution()`).

The documented design intent is coherent — one canonical event (`WORKFLOW_TRIGGER_CREATED`) starts the SF — but the last wire from that event to `StartExecution` was never built.

## Non-goals

- No architectural re-design. The previously-documented design is correct; this plan closes the single missing wire.
- No changes to the `resumeStateMachine` pipeline, `CallbackIngress` handler, `AssemblePacket` Lambda, `AgentCore Memory` configuration, `Egress` CDC for `DecisionPacket`/`AgentOutput`, or any cross-domain adapter rule.
- No new event-processor pipeline primitive (`startStateMachine`). The existing `Orchestration.triggers` path is sufficient for this fix.
- No changes to the set of 11 trigger event types, to `decisionId` allocation, or to the `WorkflowTrigger` DDB row semantics.
- No change to idempotency/deduplication behaviour (out of scope).

## Original architecture — reference

The canonical Step Function flow this service implements:

1. **Trigger fan-in** — `TriggerIngress` uses the `materializeToTable` event-processor pipeline to subscribe to 11 heterogeneous trigger events on `advisoryBus` (`MANDATE_CREATED`, `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`). Each trigger writes a `WorkflowTrigger` DDB row with a freshly-allocated `decisionId`. Status: ✅ implemented.
2. **CDC normalisation** — `Egress` uses the `changeDataCapture` pipeline: DDB stream on `WorkflowTrigger:INSERT` emits the single canonical event `WORKFLOW_TRIGGER_CREATED` on `advisoryBus`, carrying `decisionId` + `tenantId` in `subject`. Status: ✅ implemented.
3. **Start execution** — `WORKFLOW_TRIGGER_CREATED` starts the SF. Status: ❌ **missing — this plan's sole fix.**
4. **Agent dispatch** — SF task states use `arn:aws:states:::events:putEvents.waitForTaskToken` to emit `ANALYZE_INVESTOR_PROFILE`, `ANALYZE_MARKET`, `CONSTRUCT_PORTFOLIO`, `GENERATE_NARRATIVE` with a `$$.Task.Token`. Status: ✅ implemented.
5. **Agent completion** — each agent writes its output to `AgentCore Memory` and emits its corresponding `*_COMPLETED` event (carrying the task token) back on `advisoryBus`. Status: ✅ implemented per-agent.
6. **Resume** — `CallbackIngress` uses the `resumeStateMachine` event-processor pipeline (`libs/event-processor/src/pipelines/resume-state-machine.ts`) to consume `*_COMPLETED` / `DECISION_APPROVED|BLOCKED` / `USER_CONFIRMED|REJECTED` events, extract `payload.subject.taskToken`, and call `SendTaskSuccess` / `SendTaskFailure`. Idempotent on `TaskTimedOut` / `InvalidToken` / `TaskDoesNotExist`. Status: ✅ implemented.
7. **Assemble + compliance + user confirmation + terminal** — SF invokes `AssemblePacket` Lambda, publishes `RECOMMENDATION_PROPOSED`, waits for compliance via task token, branches on L1/L2 authority, optionally waits for user response via task token. Status: ✅ implemented.

Only step 3 is missing.

## The fix (Option X — narrow, construct-native)

### Change 1 — `services/advisory/decision-workflow-ctrl/src/service.stack.ts`

Replace the `Orchestration`'s `triggers: []` with the single canonical start event:

```ts
const orchestration = new Orchestration(this, 'DecisionStateMachine', {
  state,
  definitionBody: decisionWorkflow.definitionBody,
  triggers: [DecisionWorkflowEventTypes.WORKFLOW_TRIGGER_CREATED],
  timeout: Duration.hours(72),
});
```

The existing `Orchestration` construct creates one EB Rule per event type in `triggers`, with `SfnStateMachine` as target and `RuleTargetInput.fromEventPath('$.detail')` as input shape. Nothing else about the construct needs to change.

### Change 2 — `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`

The SF's existing agent invocation task states reference `$.decisionId` and `$.tenantId` directly. The construct forwards the EB event's `$.detail` to the SF as input; for a CDC-emitted `WORKFLOW_TRIGGER_CREATED`, that detail field is the event-processor envelope shape (typically `{ subject: { decisionId, tenantId, ... }, meta: { ... } }`).

Add an entry `Pass` state (`AllocateInput` or similar) that flattens `subject` to the top level:

```ts
const allocateInput = new sfn.Pass(this, 'UnpackTriggerEnvelope', {
  parameters: {
    'decisionId.$': '$.subject.decisionId',
    'tenantId.$': '$.subject.tenantId',
    'trigger.$': '$.subject.trigger',
    'context.$': '$.subject.context',
  },
});
// chain: allocateInput.next(parallelProfiling)...
```

The exact field paths MUST be verified empirically (plan task 1) against a real `WORKFLOW_TRIGGER_CREATED` envelope observed on the bus, not assumed from documentation.

### Change 3 — `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`

Remove the misleading comment *"CDK EventBridge rule starts Step Functions when CDC publishes `WORKFLOW_TRIGGER_CREATED`"*. No functional change to the handler (it still writes the `WorkflowTrigger` row; that's its job). Replace with a brief, accurate docstring noting that `WorkflowTrigger:INSERT` triggers CDC emission of `WORKFLOW_TRIGGER_CREATED`, which in turn starts the state machine via the explicit `triggers` wiring in `service.stack.ts`.

### Change 4 — Integration test

`services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts` currently asserts:
- `WorkflowTrigger` DDB row is written (keep).
- `WORKFLOW_TRIGGER_CREATED` is emitted on the bus (keep).

Add an assertion that an SF execution is started after the CDC emission. Use the integration-testing harness's available fixtures (follow the patterns already used by other SF-bearing services — reference: `services/execution-ctrl/test/integration/*` or similar; confirm during plan task).

### Change 5 — CDK unit test

`services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` — add assertions via `Template.fromStack(stack)`:
- An `AWS::Events::Rule` exists with `detail-type = [WORKFLOW_TRIGGER_CREATED]` on the advisory bus.
- That rule has an `SfnStateMachine` target pointing at the DecisionStateMachine.

### Change 6 — Flow spec

`flows/advisory-cycle.flow.yaml` — delete the aspirational NOTE at lines 30-32 and replace with an explicit step documenting the `WORKFLOW_TRIGGER_CREATED → DecisionStateMachine` EB Rule. Preserve all other steps verbatim.

### Change 7 — Data-flow doc (regenerated)

`docs/data-flows/advisory-cycle.md` — regenerate from the updated flow spec (existing tooling).

### Change 8 — Service card

`services/advisory/decision-workflow-ctrl/CLAUDE.md` — regenerate via `audit-service` skill. Expected diff: a line noting that `WORKFLOW_TRIGGER_CREATED` is the SF trigger (previously described as "started via CDC chain (no direct EB trigger)").

## Verification

### Build / test / deploy gates

1. `pnpm nx run-many -t test,lint,build,typecheck -p decision-workflow-ctrl` → green.
2. `pnpm nx affected -t test,build,lint` → green (catches any cross-project ripple; expected minimal).
3. `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl` → success.

### Defect 1 smoke check (post-redeploy)

4. `aws events list-rules --event-bus-name dev-advisory-event-bus --name-prefix dev-decision-workflow-ctrl --region us-east-1` → expected ≥ 3 rules:
   - TriggerIngress rule (subscribing to 11 trigger events)
   - CallbackIngress rule (subscribing to 8 completion events)
   - New `WorkflowTriggerCreatedRule` (subscribing to `WORKFLOW_TRIGGER_CREATED`) with `SfnStateMachine` target.
5. `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/dev-decision-workflow-ctrl --region us-east-1` → expected log groups include both `IngressHandler` (Trigger) and `IngressHandler` (Callback).

If steps 4 or 5 fail, Defect 1 is a cdk-constructs `Ingress` bug. Pause and escalate with a separate plan.

### Exit criteria (live sandbox)

6. `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -t first-decision` → runs.
7. `aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine --max-results 5 --region us-east-1` → shows a fresh execution whose `startDate` is within the test run window. **Mandatory.**
8. Each of the four agents' CloudWatch log groups (`/aws/bedrock-agentcore/runtimes/investor_profile*`, `.../portfolio_engine*`, `.../market_intelligence*`, `.../advisory_narrative*`) shows a fresh invocation stream during the same window. **Mandatory.**

Both (7) and (8) must be green to consider the plan complete.

## Risks + mitigations

| ID | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | SF input envelope shape differs from assumption (`$.subject.decisionId` path) | Medium | Plan task 1 captures a real `WORKFLOW_TRIGGER_CREATED` detail payload empirically (one-shot `putEvents` through the bus + tap via integration-testing `EventBusTrap`, or inspect an existing integration test run); entry `Pass` state is written against the observed shape, not assumed. |
| R2 | CallbackIngress still missing after redeploy (construct bug, not stale deploy) | Low-medium | Post-deploy smoke check (verification step 5) catches this before e2e runs. Escalation path: separate plan to reproduce + fix the cdk-constructs `Ingress` bug. |
| R3 | Duplicate trigger events start duplicate SF executions (two `GOAL_UPDATED` in quick succession → two decisions) | Out of scope | Pre-existing; not worsened by this plan. Track as a follow-up if e2e flakes. |
| R4 | `first-decision.e2e.test.ts` asserts current behaviour (`withLiveDecision` returns a decisionId via advisory-ctrl's lifecycle path, which bypasses the SF) and may break when the SF also runs and writes its own DecisionPacket | Medium | Plan task includes a dry-run check of the e2e test behaviour post-fix; adjust the scenario fixture or BFF read path if a race emerges. Reference: `project_pipeline_trigger_gap.md`'s description of why the e2e looked healthy even while the SF was dead. |
| R5 | LangGraph agents fail with misconfigured Memory or missing SSM params once they start receiving real invocations | Low | Per `memory/project_pipeline_trigger_gap.md` "Verified working at unit/infra level", the agents themselves were deploy-verified in Plan 2. Surface via CloudWatch on first real invocation. |

## Out-of-scope follow-ups

- Add a `startStateMachine` pipeline primitive to `event-processor` (symmetric with `resumeStateMachine`). Would enable richer "start" semantics (idempotency on `executionName`, input transformation, intents) but is not needed for this fix.
- Add SF-execution deduplication via `executionName` derived from a subject key (addresses R3).
- Audit whether any other `*-ctrl` service has the same CDC-chain-without-subscriber anti-pattern.
