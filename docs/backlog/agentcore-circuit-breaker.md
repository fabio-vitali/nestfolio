---
id: agentcore-circuit-breaker
status: queued
rank: 8
type: design
notes: "Design + ship a circuit breaker for InvokeAgentRuntime calls across the 5 agent runtimes (onboarding-bff, PE, AN, IP, MI). Layered defense on top of the just-shipped retry classification (commits 06317f37 + 54e7ed8b). Retry handles transient bursts; CB caps sustained outages (Bedrock regional failure, quota fully exhausted under prod multi-tenant load). Rule of three with broker-alpaca-adpt CB pattern — design may extract a generic CB lib."
references:
  - services/execution/broker-alpaca-adpt/src/repositories/circuit-breaker.repository.ts
  - libs/cdk-constructs/src/core/circuit-breaker-heal.ts
  - services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts
  - services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# agentcore-circuit-breaker

## Why now (rule of three)

The project has a circuit breaker in `broker-alpaca-adpt` (service-specific implementation) and a `CircuitBreakerHealDefinition` CDK construct for the recovery workflow. Adding AgentCore as a second concrete use case is the rule-of-three moment to decide whether to:

- (a) Replicate the broker-alpaca pattern per agent service (5 copies)
- (b) Extract a generic CB lib (`libs/circuit-breaker`?) that both broker-alpaca-adpt and the agent services consume
- (c) Reshape the broker-alpaca CB into a generic primitive that's reused for agents

The brainstorm should resolve which.

## What the CB protects against (and what it doesn't)

**Retry classification (shipped 2026-05-27) handles:**
- Per-request transient errors (Bedrock throttle, maxVms contention bursts that clear in ~30s)
- SQS visibility-timeout redelivery keeps the same task token alive across the contention window

**CB layered on top handles:**
- **Sustained outages** — Bedrock regional failure, quota fully exhausted across multi-tenant prod load, model deprecated mid-deploy, network partition lasting > visibility window
- **Cost protection** — if a downstream is fundamentally broken, retry-forever-via-SQS is a cost trap (each redelivery still pays Lambda + Bedrock startup tokens). CB fast-fails to cap the damage.
- **Cascading failure prevention** — if PE is down, fast-failing AN's downstream callers (e.g., DWC SF) prevents the whole pipeline from piling up

**What CB doesn't help with:**
- The transient-burst pattern Phase 2 measured (264/min for ~60s) — retry classification already handles cleanly. A CB tripping on these bursts would just add cooldown latency.

## Design surface

1. **Trigger condition** — error rate threshold? Number of consecutive failures? Rolling window size?
2. **State persistence** — DDB (like broker-alpaca-adpt) vs in-memory (lossy across Lambda cold starts)? Per-runtime keys?
3. **Open-duration policy** — fixed timeout vs adaptive (exponential backoff on repeated trips)?
4. **Half-open behavior** — how many test invocations before closing?
5. **Observability** — emit `CircuitBreakerStateChanged` events? CloudWatch metrics? Alarms?
6. **Per-runtime vs per-account** — each agent runtime has independent failure modes (e.g., PE throttle ≠ AN throttle); CB state should be per-runtime
7. **Heal workflow** — reuse the existing `CircuitBreakerHealDefinition` SF? Adapt?

## Open question — generalization scope

Designing a generic CB lib AT THIS POINT may be premature (the broker-alpaca and AgentCore failure modes are genuinely different — broker is per-request flakiness, AgentCore is contention). The brainstorm should explicitly decide whether to:
- Generalize now (cleaner long-term but more design work upfront)
- Implement per-service now, generalize on the 3rd consumer (YAGNI-pragmatic)

## Related

- Parent: playwright-rebalance-real-agents-maxvms-remediation (surfaced during user's resilience-framing discussion)
- Existing prior art: broker-alpaca-adpt (`services/execution/broker-alpaca-adpt/src/repositories/circuit-breaker.repository.ts`)
- Existing CDK construct: `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`
- Companion layer (shipped): retry classification in PE+AN handlers (commits `06317f37` + `54e7ed8b`)
