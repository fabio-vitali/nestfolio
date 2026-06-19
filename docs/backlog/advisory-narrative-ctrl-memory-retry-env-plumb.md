---
id: advisory-narrative-ctrl-memory-retry-env-plumb
status: parking
type: tooling
notes: "Plumb MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE as Lambda env var on dev so integration test can tighten waitForItem 60s→10s. Risk: dev/prod Memory-consistency skew."
references:
  - "services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:56-58"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: advisory-narrative-memory-read-latency
epic_role: core
---

# advisory-narrative-ctrl: plumb MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE on dev

The handler at `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:56-58` reads `process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE` to short-circuit a 28-second portfolio-engine eventual-consistency retry loop. The env var is currently **never set on the deployed Lambda** — only the in-process unit tests respect it.

## Cheapest path

1. Add `MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE: '0,0,0,0'` to the Ingress Lambda environment in `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` gated on `prefix === 'dev'` (or any non-prod prefix).
2. Redeploy advisory-narrative-ctrl on dev.
3. Tighten `advisory-narrative-ctrl.integration.test.ts:81` from `60_000` to `10_000`.
4. Validate: run integration test 3x, capture wall-clocks.

## Risk

Production keeps the 28 s retry; dev does not. A regression in AgentCore Memory consistency on dev would NOT be observed via this integration test. The same regression would only surface in the deployed-dev e2e suite (which exercises the full SF chain and pays real upstream eventual-consistency).

## Context

Filed as follow-up from `advisory-narrative-ctrl-tightening-cold-start-flake` (shipped 2026-05-13). See that dossier for full investigation. Competing fix path: `advisory-narrative-ctrl-eager-write-refactor` (handler-side change, no dev/prod skew, larger blast radius).
