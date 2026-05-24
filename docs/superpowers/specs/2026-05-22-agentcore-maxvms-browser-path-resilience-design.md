# AgentCore `maxVms` resilience for the browser/onboarding path

**Date:** 2026-05-22
**Status:** Design — approved, pending spec review
**Workstream id:** `agentcore-maxvms-browser-path-resilience`

## 1. Problem

The Playwright suite `apps/nestfolio-e2e` fails 2/4 specs (`new-investor-happy-path`,
`deposit-reload-mid-flight`). Both dead-end at onboarding wizard phase 1 showing
*"Connessione interrotta. Controlla la tua rete e riprova."*

Root cause, evidenced from the Playwright trace: the browser's `POST /api/copilotkit`
returns **HTTP 402**, `x-amzn-errortype: ServiceQuotaExceededException`, body:

```json
{"message":"maxVms limit exceeded for account 771924376645. Please contact AWS Support for more information."}
```

The account hit its Bedrock AgentCore account-wide micro-VM (`maxVms`) ceiling. With
5 active runtimes sharing one account limit, an e2e run drives the concurrent
micro-VM count to the cap; `InvokeAgentRuntime` is then rejected before a micro-VM
is allocated. CloudFront→CF-function→AgentCore wiring was verified correct and in
sync — this is pure resource exhaustion, not a code defect.

## 2. Why existing resilience does not cover this

The shipped `agentcore-invocation-resilience` workstream made `maxVms` non-fatal —
but only for the **backend, SQS-driven** agent path: `event-processor` `isRetryable()`
classifies `ServiceQuotaExceededException`/`ThrottlingException` as retryable, so the
SQS message is kept and **native SQS redrive** retries it minutes later once
micro-VMs idle out (`agentcore-quota-retry-stale-lock` fixed the lock that defeated it).

The onboarding agent path has no queue: the browser's `@ag-ui/client` `HttpAgent`
does a synchronous streaming SSE `POST` → CloudFront `/api/copilotkit` → AgentCore.
A 402 lands directly in `onboarding-chat.component.ts`'s SSE `error` callback. There
is nothing server-side to redrive it. The two suites therefore fail differently on
the same root cause: `e2e-feature-tests` self-heals, `nestfolio-e2e` dead-ends.

## 3. Approach

Two independent fixes. The first reduces how often the 402 occurs at all; the
second makes a transient 402 non-fatal for the browser. **Concurrency caps on agent
ingress handlers are explicitly excluded** (see §6).

### Part 1 — Idle-timeout headroom (4 CDK stacks)

The 4 advisory/investor agent runtimes — `investor-profile-ctrl`,
`portfolio-engine-ctrl`, `market-intelligence-ctrl`, `advisory-narrative-ctrl` —
call `new AgentRuntime(...)` with no `idleTimeout`/`maxLifetime`, inheriting the
construct defaults of **15 min idle / 4 h max lifetime**
(`libs/cdk-constructs/src/extensions/agent-runtime.ts:70-71`). These agents run
headless burst sessions (a decision cycle is ~30–60 s, then that session is never
invoked again), so a 15-min idle keeps each finished session's micro-VM allocated
as dead weight.

Each of the 4 `service.stack.ts` files adds to its `new AgentRuntime(...)` call:

```ts
idleTimeout: Duration.minutes(2),
maxLifetime: Duration.minutes(30),
```

A 2-min idle sits below the ~240 s SQS-redrive window that
`agentcore-invocation-resilience` configured for `investor-profile-ctrl` — so a
402'd invoke's micro-VMs are reclaimed *before* its redrive fires, which is the
desired interaction. Cold-start cost is irrelevant: burst sessions are never
re-invoked, and the value matches the rationale already documented on the
onboarding runtime (5 min/1 h, tightened after the 2026-04-21 cost spike).

**Tests:** each service's `test/unit/service.stack.test.ts` gains a CDK assertion
that the runtime's `lifecycleConfiguration` carries the new values.

### Part 2 — Onboarding browser auto-retry (`onboarding-chat.component.ts`)

`@ag-ui/client`'s `runHttpRequest`, on a non-OK response, throws an `Error` with
`error.status` (the HTTP status) and `error.payload` (the parsed JSON body)
attached — verified in `node_modules/@ag-ui/client/dist/index.mjs`. So the SSE
`error` callback can distinguish a 402/429 from any other failure.

New behavior in `runAgent()`'s stream `error` callback:

- If `err.status === 402 || err.status === 429` **and** the auto-retry budget is
  not exhausted → schedule `runAgent(this.messages())` after a backoff delay,
  increment the attempt counter, and surface a new `reconnecting` signal state
  (*"Riconnessione in corso…"*) instead of the error alert.
- Backoff schedule: **`[2000, 4000, 8000]` ms** — 3 attempts, ~14 s total added
  wait before falling back to the manual *"Riprova"* button.
- Any other error, or budget exhausted → existing error-state behavior.
- When the budget is exhausted on a *quota* error specifically, the terminal
  message is an accurate one (*"Servizio temporaneamente sovraccarico, riprova tra
  poco."*) rather than the misleading network-error copy.

The attempt counter resets on every **user-initiated** run (`ngOnInit`'s initial
turn, `sendMessage`/`submitUserContent`, the manual `retry()`), and is *not* reset
by an auto-retry — so it tracks consecutive auto-retries within one logical turn.
The backoff timer is registered for cleanup in `cleanup()` / `destroyRef`.

**Tests:** `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts` — with
a mocked `HttpAgent` whose `run()` emits an error carrying `status: 402`:
auto-retry fires after the backoff (fake timers), `reconnecting` state shown;
after 3 failed attempts the terminal quota message is shown; a non-402 error goes
straight to the error state with no retry.

## 4. Data flow (Part 2)

```
ngOnInit / sendMessage / retry()  ──reset attempt counter──▶ runAgent()
                                                                │
                                              HttpAgent SSE POST │
                                                                ▼
                                              error: { status, payload }
                                                                │
                            ┌───────────────────────────────────┤
            status 402/429 + budget left          status other / budget spent
                            │                                   │
              show "reconnecting",                   show error alert
              setTimeout(backoff[n])                 (quota copy if 402/429,
              → runAgent(messages())                  generic copy otherwise)
```

## 5. Validation gate

- Unit: the 4 advisory `service.stack.test.ts` CDK assertions green; the
  `onboarding-chat.component.spec.ts` retry tests green; `nx affected` for the
  touched projects green (test + lint).
- Deploy the 4 advisory services to dev sandbox
  (`deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl`).
- Rerun `apps/nestfolio-e2e` — the 2 previously-failing specs green.
- A real `maxVms` 402 cannot be deterministically forced end-to-end, so the
  retry path itself is unit-proven (same posture recorded by
  `agentcore-quota-retry-stale-lock`).

## 6. Out of scope

- **Concurrency caps** on agent-invoking ingress handlers (Option D from
  `agentcore-invocation-resilience`) — explicitly excluded by the user.
- **Production `maxVms` quota increase** — tracked by
  `agentcore-maxvms-prod-quota-increase`.
- **Server-side proxy retry** for the onboarding path — rejected; proxying an SSE
  stream through Lambda adds latency/cost and duplicates the design spec's
  already-rejected in-handler retry.
- **The onboarding runtime's own timeouts** — already tightened to 5 min/1 h.
- **The backend SQS-driven resilience path** — shipped and working
  (`agentcore-invocation-resilience`, `agentcore-quota-retry-stale-lock`).
- **`onboarded()` e2e fixture / agent coupling** — shipped as
  `e2e-fixture-agentcore-synchronous-coupling`.

## 7. Risks

- **Runtime replacement on `lifecycleConfiguration` change.** If a CFN update of
  `lifecycleConfiguration` replaces the AgentCore runtime (new ARN) rather than
  updating it in place, the new ARN is still consumed only within the same
  per-service stack (the agent's own Step Functions orchestration), so a single
  per-service `deploy.sh` resolves it — no cross-stack staleness like the
  onboarding↔investor-web `copilot-rewrite.js` coupling. Confirm the update
  behavior during planning; if it replaces, the deploy step already covers it.
