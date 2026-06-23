---
id: bff-readmodel-w3-advisory-decision-packet
status: shipped
closed: 2026-05-31
rank: 3
type: refactor
requires_deploy: true
out_of_scope:
  - "investor-bff CashBalance P1 + command-row confirmation (field-level + condition + seed-by-event) — workstream 4."
  - "Externally-settled Deposit/Withdrawal/Order ownership + intent events + broker-ctrl lifecycle owner — workstream 5 (cross-domain, last)."
  - "Governance/freeze enforcement layers 3+4 (event-processor-patterns / create-* / testing-patterns skills, CLAUDE.md router pointer, audit-service/-domain/-system drift checks, CI lint) — workstream 6. Only the advisory-bff + dashboard-bff ReadModelOwnership typename registrations for the rows this workstream migrates land here."
  - "Live-push transport for advisory/decision rows — rebuilt on the clean read model afterward (spec §Out of scope); not part of this materialization workstream."
  - "Event sourcing on the write side — program-wide out of scope; system stays state-stored-aggregate + CDC-outbox (spec §Out of scope)."
  - "Re-architecting the L1/L2 authority split or the compliance↔decision-workflow task-token handshake beyond what is needed to emit one authoritative versioned DecisionPacket snapshot. If consolidating the multi-writer status path requires an aggregate-owner promotion (spec §Command-side rules escalation), that is surfaced as a decision, not silently expanded."
notes: "Workstream 3 of bff-read-model-materialization-redesign: decision-workflow-ctrl emits versioned DecisionPacket snapshots; advisory-bff + dashboard project them as P1; retire the advisory-bff attribute_exists sparse-item band-aid + status-fragment events; AdvisoryStatus count → P3."
references:
  - "docs/superpowers/specs/2026-05-30-bff-readmodel-w3-advisory-decision-packet-design.md"
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-30-bff-readmodel-w3-advisory-decision-packet-design.md
plan: docs/superpowers/plans/2026-05-30-bff-readmodel-w3-advisory-decision-packet.md
topic_memory: [project_read_model_redesign.md]
validation_gate: "event-processor:typecheck + unit ×7 green (293 ep / 136 dwc / 106 advisory-mfe); affected lint ×7 green; deploy --services=decision-workflow-ctrl,advisory-bff,dashboard-bff,investor-adpt → all 4 stacks UPDATE_COMPLETE on dev (incl. the aws-sdk:dynamodb:updateItem.waitForTaskToken SF state — CloudFormation accepted it, fallback not needed); integration on deployed dev GREEN (decision-workflow-ctrl 20, advisory-bff 8 rewritten to w3 contract, dashboard-bff 21); REAL-pipeline e2e GREEN — Playwright new-investor-happy-path (full L2 confirm UI through the real SF + versioned projection, 3.5m). Final whole-branch review: APPROVE-WITH-NITS (4 hardening follow-ups → w3-advisory-versioned-packet-hardening). KNOWN GAP (queued, NOT a product defect): the synthetic Jest e2e apps/e2e-feature-tests/src/advisory/{accept,reject}-decision encode the pre-w3 producer-owned model (withDecision injects DECISION_PACKET_CREATED without __version + asserts the mutation returns CONFIRMED) and need a harness rework for the producer-owned/versioned model — filed as e2e-feature-advisory-fixtures-w3-contract. Real path verified by the Playwright full-pipeline run above + the deployed-dev integration suite."
---

# Workstream 3 — advisory (versioned DecisionPacket)

> ⚠️ **EFFORT: xhigh** (`effort: xhigh` in frontmatter). Set reasoning effort to
> xhigh before executing this workstream — do not run it at the default. Why:
> producer change (decision-workflow-ctrl emits versioned snapshots) coordinated
> across **two** consumers (advisory-bff + dashboard-bff), and it touches the
> most race-prone path in the system — the sparse-item race and the
> APPROVED→AWAITING_CONFIRMATION overwrite race both live here, with multiple
> shipped bug fixes already. "Races gone by construction" needs the deep budget.

Make the decision read model a versioned P1 projection driven by an
authoritative producer, retiring the sparse-item-race band-aid.

## Scope / deliverables
- `decision-workflow-ctrl` (and/or compliance, per the producer's authority)
  stamps a `__version` on the `DecisionPacket`/`DecisionReadModel` row and emits
  full versioned snapshots.
- advisory-bff + dashboard-bff project those snapshots via `projectVersioned`
  (P1); register the typenames in `ReadModelOwnership`.
- Retire the advisory-bff `attribute_exists(pk)` UPDATE-before-CREATE band-aid
  and the per-field status-fragment events (no longer needed once a full
  versioned snapshot is emitted).
- `AdvisoryStatus` in-flight count → P3 derived from the advisory-owned decision
  rows (not `accumulate`d across trigger/resolution events).

## Done
DecisionPacket is a versioned P1 projection; the sparse-item race and the
APPROVED→AWAITING_CONFIRMATION overwrite races are gone by construction;
`event-processor:typecheck` + integration green; deploy + the advisory-flow
Playwright/e2e scenarios green.

## Carry-over from w2
dashboard-bff's `AdvisoryStatus` in-flight count remains an `accumulate` counter
(NOT registered in `ReadModelOwnership`) — a true P3 derivation needs the
authoritative `DecisionPacket` rows. This workstream lands the real P3 count over
the versioned `DecisionPacket` rows it projects, and registers `AdvisoryStatus`
as `Projection<'P3'>` in dashboard-bff's ownership map.

## Rollout context
Rank 3 (see spec §"Decomposition"). See [[project_read_model_redesign]].
