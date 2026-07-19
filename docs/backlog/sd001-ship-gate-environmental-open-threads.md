---
id: sd001-ship-gate-environmental-open-threads
status: parking
type: infra
notes: "Two environmental open threads from the 2026-07-19 pre-ship deploy-gate: Docker daemon required for onboarding-bff's container asset, and a journaled typed-subjects RUNTIME_GATE_SKIP awaiting ship-recheck adjudication."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Ship-gate environmental open threads (2026-07-19 batch)

Two open threads noted at Entry 33 with no better existing home:

1. **Docker daemon dependency** — the 2026-07-19 pre-ship deploy-gate for
   `circuit-breaker-lifecycle-e2e-breaker-stuck-open` failed only on `onboarding-bff`'s
   `OnboardingAgent` container asset: `docker build` could not connect to the Docker daemon on the
   dev machine. 26/27 stacks deployed clean, including `dev-investor-bff` and
   `dev-broker-alpaca-adpt`. The daemon needs to be running before any deploy-gate that touches
   `onboarding-bff`'s container asset.
2. **Typed-subjects RUNTIME_GATE_SKIP** — a journaled skip on item
   `circuit-breaker-lifecycle-e2e-breaker-stuck-open` awaiting ship-recheck adjudication (the
   only Guard skip taken on that item, chosen by the owner at the floor per Entry 33's standing-
   rules audit).

Surfaced by the 2026-07-19 pre-ship deploy-gate batch (Entry 33); filing deferred to this session.
