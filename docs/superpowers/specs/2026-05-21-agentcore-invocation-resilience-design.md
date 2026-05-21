# AgentCore invocation resilience — design spec

**Date**: 2026-05-21
**Backlog**: `docs/backlog/agentcore-invocation-resilience.md`
**Type**: spec
**Trigger**: e2e `onboarded()` fixture timeouts (`InvestorProfileSnapshot not materialised within 60s`) — 3 failures in the full feature suite, `request-closure` failed 2/3 reruns, root-caused to `ServiceQuotaExceededException: maxVms`.

## 1. What fails

Chain: `ONBOARDING_COMPLETED` → investor-bff materialises composite row → CDC `MANDATE_ISSUED` / `INVESTOR_PROFILE_UPDATED` → investor→advisory adapter → **IP-ctrl IngressHandler** → Bedrock AgentCore `InvokeAgentRuntime` (user-goals Haiku + risk-assessment Sonnet 4.6) → writes `InvestorProfileSnapshot`.

CloudWatch evidence (IP-ctrl `IngressHandler`, 95-min window, 2026-05-21):

- **Hard quota failure** — `10:33:02` `MANDATE_ISSUED` tenant `e2e-1779359572801`: `ServiceQuotaExceededException: maxVms limit exceeded for account 771924376645`, **`retryable: false`**.
- **Slow-invoke tail** — AgentCore invoke durations of **54s / 58s / 82s / 89s** (normal ≈ 19–26s) — all blow the 60s fixture budget.
- **Systemic saturation** — `portfolio-engine-ctrl` IngressHandler hit `maxVms` **159×** in 50 min; `advisory-narrative-ctrl` 8×.

`maxVms` is the Bedrock AgentCore account+region quota on concurrent micro-VMs. The e2e suite fans out IP + 4 advisory agents + onboarding agent against one shared quota. Saturation manifests two ways: outright rejection, or 80–90s queue/cold-start latency.

## 2. The two real defects

### 2.1 `ServiceQuotaExceededException` is misclassified as non-retryable (system-wide)

`libs/event-processor/src/internal/errors.ts` — `isRetryable()`:

```ts
return error.$retryable !== undefined || error.$fault !== 'client';
```

The AWS SDK marks `ServiceQuotaExceededException` with `$fault: 'client'` and `$retryable: undefined` → `isRetryable()` returns **false**. AWS docs define this exception as *"the number of requests exceeds the service quota — resubmit your request later"* — **transient by definition**. Misclassifying it means the event-processor publishes an `INVESTOR_PROFILE_CTRL_FAILED` error event and **deletes the SQS message** — snapshot permanently lost, no retry. Affects *every* agent-invoking service.

### 2.2 The slow-invoke tail exceeds the e2e fixture's 60s budget

`invoke-agentcore.ts` does a bare `client.send(InvokeAgentRuntimeCommand)` — default SDK retry only, which does not retry the quota error. Even successful invokes reach 89s under saturation.

## 3. Architectural insight — IP-ctrl ≠ PE/AN

The 2026-05-18 spec (`agent-pipeline-backlog-trap-architectural`) built `agentProfile()` for deadline-bound agents (PE/AN, whose latency gates an SF task token) and **deliberately excluded continuous projection writers**. IP-ctrl *is* a projection writer (`materializeToTable` snapshot writer). Post-precomputation (2026-05-17) it resumes **no SF task token** — it writes `InvestorProfileSnapshot`, which DWC's SnapshotProjectorIngress mirrors and the per-cycle SF reads later via DDB GetItem.

**Therefore: in production, IP-ctrl snapshot materialisation has no hard deadline — it is eventually-consistent.** The only 60s deadline is the e2e `onboarded()` fixture poll — a test-harness concern.

This makes *SQS→Lambda native retry* the architecturally correct answer for IP-ctrl: a minutes-grained recovery is *correct* for an eventually-consistent projection, not a compromise. Each redrive is a fresh Lambda — so native retry survives outages longer than one Lambda duration, which an in-handler retry loop cannot.

## 4. Current IP-ctrl ingress config (`agentProps`)

| Knob | Value | Source |
|---|---|---|
| Lambda timeout | 300s | `agentProps` |
| SQS visibility timeout | 1800s (6 × lambda) | `ingress.ts:118` auto-calc |
| DLQ `maxReceiveCount` | 10 | `ingress.ts:125` |
| Message retention | 14 days | queue/DLQ defaults |
| ESM `maxConcurrency` | 5 | `agentProps` |
| `reportBatchItemFailures` | true | `ingress.ts:168` |

Already a robust *production* retry config — except defect 2.1 means the quota error never enters the retry path.

## 5. Solution (decision: A + B, approved 2026-05-21)

### 5.1 Defect A — fix the classification (event-processor, system-wide)

`isRetryable()` treats `ServiceQuotaExceededException` and `ThrottlingException` as retryable regardless of `$fault`. Quota/throttle exceptions are transient by definition. One central change; benefits every agent service.

### 5.2 Defect B — tune IP-ctrl SQS knobs so native redrive is fast

| Knob | Today | New | Why |
|---|---|---|---|
| Lambda timeout | 300s | **150s** | agent p99 ≈ 89s; 150s covers it with margin, not over-provisioned |
| SQS visibility timeout | 1800s | **240s** | redrive lands ≈ 4 min after a `maxVms` hit — VMs almost always free by then |
| `maxReceiveCount` | 10 | 10 (unchanged) | 10 × 240s = 40 min retry horizon, well within 14-day retention |

Set via explicit `lambdaTimeout` + `visibilityTimeout` props on the `Ingress` construct (both already supported). `profile: agentProps` stays for memory/bundling/concurrency/batchSize.

### 5.3 Defect B — widen the e2e fixture budget

`apps/e2e-feature-tests/src/helpers/fixtures.ts` `onboarded()` `InvestorProfileSnapshot` poll: **60s → 360s**. Covers one full SQS redrive (240s visibility + ≈ 90s agent invoke + ≈ 20s CDC/EB/adapter). A test-harness change, justified: production has no deadline; the fixture must tolerate the native-retry recovery window.

### 5.4 ledger-bff `quantity` schema fix (folded in — see §8 rationale)

`getPortfolio.positions[].quantity` is declared `Int!` but notional/dollar fills produce fractional shares — AppSync fails to serialise, breaking the whole query (surfaced in `accept-decision.e2e`). `dashboard-bff` already uses `Float!`. Fix `services/ledger/ledger-bff/src/schema.graphql`: `Position.quantity` and `PositionDiff.{actualQuantity,simulatedQuantity,quantityDiff}` `Int! → Float!`. All downstream TS code already uses `number`; no resolver changes. Validated by the same e2e gate.

## 6. Validation gate

- Unit: `event-processor` `isRetryable()` — `ServiceQuotaExceededException` / `ThrottlingException` → retryable.
- CDK: IP-ctrl `service.stack.test.ts` — Lambda `Timeout` 150, SQS `VisibilityTimeout` 240.
- Deploy: `deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,ledger-bff` plus any `event-processor`-consumer redeploys.
- E2e gate: `accept-decision`, `request-closure`, `update-goal` e2e tests — **3 consecutive green runs** (per `feedback_flake_means_broken`). Pull CloudWatch evidence from any failing run before declaring done.

## 7. Out of scope

Rejected during option analysis:

- **In-handler retry inside `invoke-agentcore.ts`** — once native redrive is fast (B), its only edge (sub-60s first retry) is moot once the fixture budget is widened; it adds code, hides latency, and is capped at one Lambda duration.

Deferred — **filed as tracked backlog items** (not abandoned prose):

- **`agentcore-maxvms-prod-quota-increase`** (QUEUED) — request a `maxVms` Service Quotas increase for production accounts. Sandbox deliberately keeps the low quota (cost); native retry absorbs sandbox saturation. Prod-only because no prod env exists yet.
- **`e2e-fixture-agentcore-synchronous-coupling`** (QUEUED) — `onboarded()` synchronously blocks on a Bedrock-driven projection; even with a 360s budget the fixture is coupled to agent latency. Evaluate decoupling (e.g. seed the snapshot row directly, or assert it lazily).

Already tracked elsewhere:

- **PE/AN backlog-trap tuning** — `agent-pipeline-backlog-trap-impl`.
- **Reduce concurrent AgentCore demand (Option D)** — concurrency caps across agent ingress handlers; complementary, not on this critical path. Folded into `agentcore-maxvms-prod-quota-increase` as the sandbox-side alternative to a quota bump.
