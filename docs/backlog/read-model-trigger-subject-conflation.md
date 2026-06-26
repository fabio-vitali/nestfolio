---
id: read-model-trigger-subject-conflation
status: parking
type: epic
notes: "A read-model writer derives a row's identity or content directly from the inbound CDC trigger subject, assuming it is the canonical aggregate; a secondary (often live-path) trigger variant carries a different/partial subject shape or a different id, so it silently produces a gracefully-degraded row. Theme epic, 2 members."
done_when: "Each in-scope read-model writer reads the canonical aggregate (or keys on a stable lifecycle id) rather than trusting the raw trigger subject, so every triggering event variant produces a correct (non-degraded) row; both members shipped or dropped."
scope: "Read-model writers/rebuilders whose row key or content is derived from the inbound trigger subject and degrades when a triggering event variant's subject diverges (wrong shape / partial row / different id) from the canonical aggregate — i.e. the subject is over-trusted as the canonical input across a heterogeneous trigger set."
out_of_scope:
  - "BFF read-model semantic-richness gaps — those are bff-read-model-semantic-gaps (the row materializes correctly but projects too thin a signal); these items produce a wrong/degraded row, not a thin-but-correct one."
  - "broker-alpaca field-shape serialization drift (numeric vs string, present/absent fields) across writers — that is broker-alpaca-emission-shape-drift; this theme is about subject-derived identity/content, not output field shape."
  - "The funding-completed field-name normalization fix (transferId/amountCents/currency/userId) — already shipped as broker-funding-completed-normalization-drift; this theme holds only its explicitly-deferred residual carrier-pk divergence."
references: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Read-model trigger-subject conflation

Root cause: a read-model writer/rebuilder derives a row's **identity or content** directly
from the inbound CDC trigger subject, assuming the subject is the canonical aggregate. But the
set of events that trigger the write is heterogeneous — a secondary (often live-path) variant
carries a different or partial subject shape, or a different id — so that trigger silently
produces a **gracefully-degraded** row (no crash, no lost data, but wrong/missing carried-forward
fields). Both members are residue of the read-model-redesign program (`[[project_read_model_redesign]]`).

Fix pattern: read the canonical aggregate from its source (or key on a stable lifecycle id)
rather than trusting the raw trigger subject, so every triggering variant rebuilds a correct row.

Members (derived from `epic:` pointers):
- `ip-ctrl-snapshot-agent-fed-trigger-row` — IP-ctrl's snapshot rebuilder passes the raw trigger
  `subject` as the agent's `investorProfile`; on `MANDATE_ISSUED` the subject is a Mandate row
  (no goal/riskProfile) → degraded `InvestorProfileSnapshot`. Fix: read the actual InvestorProfile
  row, or drop the mandate-triggered rebuild.
- `broker-ctrl-alpaca-funding-carrier-pk-divergence` — on the live/ALPACA funding path the router
  keys the `requested` carrier on `depositId`/`withdrawalId` while the normalizer keys completion
  carriers on `transferId`; when they differ the carry-forward lookup misses → degraded lifecycle
  projection. Fix: key both writers on the same stable lifecycle id.
