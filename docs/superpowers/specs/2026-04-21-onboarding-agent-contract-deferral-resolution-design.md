# Onboarding Agent Contract Test — Deferral Resolution

**Date:** 2026-04-21
**Branch:** `feat/onboarding-contract-test-scenario`
**Follows:** `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md` — Phase 8 Task 8.5, Phase 9.5
**Companion memory:** `project_agent_contract_tests.md`, `project_mock_resilience.md`

## 1. Context

The Agent Contract Tests series (shipped 2026-04-21) instrumented six agent-invoking services to emit `AgentTraceEnvelope` per invocation and asserted the contract in five advisory e2e scenarios. **Onboarding was deferred** at Plan 3 Phase 8: the service-side wiring landed (event constant, `EventBridgeTraceEmitter`, `agents/onboarding/server.ts` emission seam, `grantPutEventsTo`, `AgentTraceTrap` map entry), but no e2e assertion block was added because no existing scenario drives CopilotKit turns.

The plan's follow-up sketch (Plan 3 Task 8.5) proposed a future `2026-XX-XX-onboarding-e2e-scenario.md` that would "add a CopilotKit session harness to `apps/e2e-feature-tests` + a multi-turn scenario + the assertion block." Brainstorming for that follow-up surfaced a deeper structural issue: the shape it required does not fit the e2e conventions used everywhere else in this codebase.

## 2. Structural mismatch

Every scenario under `apps/e2e-feature-tests/src/` is anchored to a **user-visible feature outcome**:

- `profile/*` — investor updates / revokes mandate or goal.
- `advisory/first-decision.e2e.test.ts` — investor sees first decision after onboarding (`withLiveDecision` returns a `decisionId` and `pipelineMetadata` observable to the user).
- `advisory/rebalance-on-drift.e2e.test.ts` — drift triggers rebalance cross-domain.
- `account/circuit-breaker-lifecycle.e2e.test.ts` — CB lifecycle.
- `funding/*`, `notifications/*` — concrete user stories.

The **agent contract assertions** in `first-decision.e2e.test.ts` are layered on top of that user story — they inspect the envelope as a *lens on* the pipeline, not as the scenario's reason for existing.

Onboarding has no comparable anchor:

- **No triggering event on the bus.** The other five agents are invoked by EventBridge subscriptions (`MANDATE_CREATED`, `GENERATE_NARRATIVE`, etc.). Onboarding's entry point is a live conversation via CopilotKit.
- **No terminating event in-budget.** The sole cross-domain user outcome (`ONBOARDING_COMPLETED` → `investor-bff/src/transforms/onboarding-completed.ts`) requires walking all seven phases, which no e2e can drive deterministically against free-text Sonnet turns.
- **No in-budget side-effect.** Two turns cannot reliably produce a `commit-phase` tool call; Sonnet's tool-selection under a cold conversation is non-deterministic.

The test shape that would fit — "a trace envelope was emitted per turn" — is a mechanism assertion, not a feature. Forcing it into the e2e suite would make it the only mechanism-only scenario in the directory and add live Bedrock token cost per CI run for a weak-signal result.

## 3. Decision

**Close the deferral without writing a new e2e scenario.**

Contract coverage for the onboarding agent moves to the integration-test layer — the correct layer for exhaustive, deterministic behavioural coverage of a conversational agent. The existing sandbox wiring is validated by a **one-shot deploy-time log smoke** (documented, not automated) that proves `InvokeAgentRuntime → /invocations → AgentTraceEnvelope on investorBus` in a live deployed runtime.

The integration-test gap (UI widget rendering, KB retrieval correctness, phase commit on every transition, risk-profile compute, hallucination floor) is recorded against `project_mock_resilience.md` as a `FakeLlm`-shaped use case.

## 4. Scope

### 4.1 In scope for this branch

1. **Server-side AgentCore alignment** — correct a latent routing bug in the onboarding runtime (see §5).
2. **SSM export of runtime ARN** (see §6).
3. **Documented deploy-time log smoke** (see §7).
4. **Memory updates** — `project_agent_contract_tests.md` resolution block; `project_mock_resilience.md` cross-reference (see §8).

### 4.2 Explicitly out of scope

- No new e2e scenario file.
- No CopilotKit session harness helper (`onboarding-client.ts`).
- No `@copilotkit/runtime-client-gql` devDep in `apps/e2e-feature-tests`.
- No changes to `agent-trace-trap.ts` — the `onboarding` entry stays (type-level parity enforcement; harmless without a consumer).
- No FakeLlm implementation; the onboarding integration-test gap is *recorded*, not *filled*, here.
- No frontend/proxy work. `onboarding-mfe` currently references `/api/copilotkit` as a future proxy that is not yet provisioned; decisions about that wire are independent of this branch.

## 5. Server-side alignment (`services/investor/onboarding-bff`)

The onboarding Hono app currently exposes `POST /copilotkit` with identity read from `x-tenant-id` + `x-session-id`/`x-user-id` headers. Bedrock AgentCore invokes container runtimes via `POST /invocations` and forwards the session as `x-amzn-bedrock-agentcore-runtime-session-id`. Today this mismatch is latent because no caller invokes the deployed onboarding runtime; the moment anyone does (e.g., the log smoke in §7, or a future frontend proxy), the current paths would 404 or miss identity.

Aligning with the advisory-agent server contract (`libs/agent-orchestrator/src/agent-server.ts:22,24,27`) removes the bug and makes the onboarding runtime behave like every other AgentCore runtime in the workspace.

### 5.1 `agents/onboarding/server.ts`

- Rename `POST /copilotkit` → `POST /invocations`.
- Add `GET /ping` alias (AgentCore health-probe convention) alongside the existing `GET /health`.
- Replace the dual-header identity read with a single parse of `x-amzn-bedrock-agentcore-runtime-session-id` formatted as `${tenantId}/${sessionId}`. Mirrors `invokeAgentCoreRuntime`'s convention (`libs/agent-orchestrator/src/invoke-agentcore.ts:45`).
- Emitter guard unchanged: emission is gated on both halves being non-empty. If either is empty after parsing, log a warning and skip emission — same behaviour as today.
- `GET /session` endpoint: left alone. It is unused by the AgentCore path and is an artefact of the planned (not-yet-built) frontend proxy. Removing it is out of scope for this branch.

### 5.2 `test/unit/runtime/server.test.ts`

- Update existing tests to exercise `POST /invocations` and the `x-amzn-bedrock-agentcore-runtime-session-id` header.
- Add a case asserting emission is skipped (and a warning logged) when the header is missing or malformed (no `/` separator).
- Add a case asserting `GET /ping` returns 200.
- Remove dead coverage for `/copilotkit` and for separate `x-tenant-id`/`x-session-id` header paths.

## 6. Stack change (`services/investor/onboarding-bff/src/service.stack.ts`)

Publish the runtime ARN as a deploy-time SSM parameter, using the exact pattern from `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:99-107`:

```ts
const runtimeArn = agentRuntime.runtime.agentRuntimeArn;
new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-onboarding-bff/agent/runtimeUrl`,
  stringValue: runtimeArn,
});
```

The parameter name follows the advisory convention (`agent/runtimeUrl`) so future consumers — a proxy Lambda, a frontend BFF resolver, or additional smoke scripts — can discover it without hardcoding.

No `grantRead` call is added here: this branch does not wire the parameter into any Lambda. Consumers add their own `grantRead` when they appear.

`test/unit/service.stack.test.ts` — add one assertion that the SSM parameter is synthesised with the expected name and references the runtime ARN.

## 7. Deploy-time log smoke (documented procedure)

The smoke proves the live AgentCore path end-to-end: `InvokeAgentRuntime → container POST /invocations → CopilotRuntime processes the turn → tracer emits → EventBridge receives an `ONBOARDING_AGENT_INVOCATION_TRACED` event on investorBus with the expected `correlationId` and `tenantId`.

### 7.1 Procedure

```bash
# 1. Deploy onboarding-bff to sandbox.
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=onboarding-bff

# 2. Resolve the runtime ARN from SSM.
RUNTIME_ARN=$(aws ssm get-parameter \
  --name "/nestfolio/dev-onboarding-bff/agent/runtimeUrl" \
  --query 'Parameter.Value' --output text --region us-east-1)

# 3. Invoke with a minimal CopilotKit turn body + a scripted session id.
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "$RUNTIME_ARN" \
  --runtime-session-id "smoke-tenant/smoke-session-$(date +%s)" \
  --payload file://fixtures/copilotkit-minimal-turn.json \
  /tmp/onboarding-smoke.json \
  --region us-east-1

# 4. Verify emission. Two paths, use whichever is available at smoke time:
#    (a) AgentRuntime container stdout in CloudWatch — the server logs
#        "onboarding trace emit failed" only on error, so a clean run
#        produces no matching line. Use the EventBridge path (b) instead
#        for a positive assertion.
#    (b) Transient EventBridge rule → CloudWatch Logs target scoped to
#        detailType = ONBOARDING_AGENT_INVOCATION_TRACED, created before
#        the invoke and deleted after. One-liner via `aws events put-rule`
#        + `aws events put-targets`; log-group name chosen at smoke time.
#    (c) Re-use the integration-testing EventBusTrap from a scratch Node
#        script under tools/ (heaviest but most direct — reuses existing
#        infra).
# Path (b) is the recommended default — smallest new surface, positive
# assertion, cleans up after itself.
```

### 7.2 Fixture

`fixtures/copilotkit-minimal-turn.json` — smallest request body that CopilotKit's `CopilotRuntime.process()` accepts without erroring on the graph's first node. Captured once during the smoke run by sniffing a real `onboarding-mfe` request in dev (document origin in the fixture's header comment). The fixture rots when CopilotKit ships a major version bump; a comment in the resolution block of `project_agent_contract_tests.md` will note "regenerate if CopilotKit major version changes."

### 7.3 Pass criteria

- `invoke-agent-runtime` returns HTTP 200 and a non-empty body.
- The chosen verification path (§7.1 step 4) surfaces exactly one event whose detail matches:
  - `detail-type = ONBOARDING_AGENT_INVOCATION_TRACED`
  - `detail.correlationId = <scripted session id>` (the sessionId half of `runtime-session-id`)
  - `detail.context.tenantId = smoke-tenant`
  - `detail.envelope.status = success`
  - `detail.envelope.errors` contains no `llm_error` entries.

### 7.4 Cadence

This is a **one-shot** verification, not a recurring job. It runs once after the server changes merge, and is re-run whenever `agents/onboarding/server.ts` or the runtime ARN export is modified. Not added to CI.

## 8. Memory updates

### 8.1 `memory/project_agent_contract_tests.md`

Move the existing `## Deferred` block's onboarding entry into a new section:

```
## Resolution: onboarding (2026-04-21)

The Phase 8 deferral closed without a dedicated e2e scenario. Rationale:
the onboarding agent's surface is a live multi-turn conversation with no
triggering event and no cross-domain outcome reachable in a deterministic
turn budget; forcing an e2e would make it the only mechanism-only
scenario in apps/e2e-feature-tests/src/.

Live-pipeline verification moves to a one-shot deploy-time log smoke
(see spec §7). Behavioural contract coverage moves to integration tests
once FakeLlm lands (tracked in project_mock_resilience.md).

Server changes shipped alongside:
- agents/onboarding/server.ts routes POST /invocations (AgentCore convention)
  and reads identity from x-amzn-bedrock-agentcore-runtime-session-id.
- service.stack.ts publishes runtime ARN at
  /nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl.
```

Remove onboarding from any remaining `## Deferred` list; the topic file now has zero open deferrals from this series. (Operating-mode-authority Phase 6 deferral is tracked separately, untouched by this branch.)

### 8.2 `memory/project_mock_resilience.md`

Append an "Onboarding feature-integration-test gap" entry under the target-use-cases section, noting the dimensions that need coverage when `FakeLlm` lands: UI widget rendering per phase, KB retrieval correctness, `commit-phase` on every transition, `compute-risk` correctness, floor for hallucination on known product facts. Cross-reference `project_agent_contract_tests.md` resolution block.

## 9. Exit criteria

- `pnpm nx test onboarding-bff` green (unit tests updated).
- `pnpm nx typecheck onboarding-bff` green.
- `pnpm nx build onboarding-bff` green.
- `pnpm nx affected -t lint` green on the changed paths.
- Sandbox deploy of onboarding-bff succeeds.
- Log smoke (§7) produces the expected event on investorBus.
- `project_agent_contract_tests.md` resolution block present; no onboarding entry remains under `## Deferred`.
- `project_mock_resilience.md` lists the onboarding integration-test gap.

## 10. Non-goals / future work

- **Onboarding behavioural integration tests.** The correct home for UI-widget, KB, phase-commit, risk-compute, and hallucination coverage. Blocked on `FakeLlm` (see `project_mock_resilience.md`). Design that as its own spec.
- **Onboarding frontend wire.** `apps/onboarding-mfe` references `/api/copilotkit` as a future proxy target; the actual proxy (Lambda URL / API Gateway / ApiFacade) is not provisioned. Out of scope.
- **Removing `GET /session`.** Dead code from the pre-AgentCore planning era. Leave it for whoever owns the frontend wire design.
- **Operating-mode-authority decision-lifecycle assertion.** Separate Phase 6 deferral from Plan 3 with three resolution paths (a/b/c). Untouched by this branch.

## 11. References

- Deferral origin: `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md` (Phase 8 Task 8.5, Phase 9.5).
- Advisory pattern reference (SSM export + route): `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:99-107`, `libs/agent-orchestrator/src/agent-server.ts:22,24,27`.
- AgentCore invocation helper: `libs/agent-orchestrator/src/invoke-agentcore.ts:40-70`.
- `AgentTraceTrap` helper (unchanged by this branch): `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`.
- Topic files: `project_agent_contract_tests.md`, `project_mock_resilience.md`.
