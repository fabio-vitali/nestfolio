---
id: advisory-narrative-memory-read-latency
status: parking
type: epic
notes: "advisory-narrative-ctrl blocks on AgentCore Memory reads before writing its observable HEAD row → 30-40s integration tests. Theme epic, 2 members."
done_when: "advisory-narrative-ctrl's observable HEAD row is visible to tests in ~5-10s (eager write and/or tightened Memory-retry delays) with no dev/prod consistency skew; both members shipped or dropped."
scope: "advisory-narrative-ctrl integration-test latency caused by AgentCore Memory-read retry delays gating the observable HEAD-row write."
out_of_scope:
  - "General cold-start integration flakiness (integration-deep-coldstart-flakes-post-trap-hardening) — a different latency cause"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-narrative-ctrl Memory-read latency

Root cause: advisory-narrative-ctrl performs AgentCore Memory reads (with retry delays) before writing the AgentInvocation HEAD row, so integration tests don't see the observable row for ~30-40s. Fix pattern: write the HEAD row eagerly before Memory reads, and/or plumb a Memory-retry-delay override env var so tests can tighten waitForItem (without dev/prod consistency skew).

Members (derived from `epic:` pointers):
- `advisory-narrative-ctrl-eager-write-refactor`
- `advisory-narrative-ctrl-memory-retry-env-plumb`
