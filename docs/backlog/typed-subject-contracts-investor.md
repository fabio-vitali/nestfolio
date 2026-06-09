---
id: typed-subject-contracts-investor
status: queued
rank: 3
type: refactor
notes: "Investor domain slice (slice 2) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Investor (slice 2)'). All tenant-scoped. investor-ctrl: extend beyond NotificationCreated to the rest (notification + monthly-report lifecycle). investor-bff: extend beyond InvestorProfileUpdated to the remaining lifecycle CDC events. onboarding-bff: confirm coverage (already has two contracts). Home rule: intra-domain consumers import producer <svc>/contracts; cross-domain consumers of investor events import via the producer-domain adapter investor-adpt/domain. Depends on phase-0 (typed-subject-platform-context-taxonomy). Validation: producer unit tests + tsc green + scoped e2e asserting the producer emits exactly what each contract declares (real DDB row / captured CDC subject, NOT fixtures — [[event-subject-contracts]]). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Typed-subject contracts — Investor (slice 2)

Second per-domain slice of the `typed-subject-producer-contracts` umbrella. All tenant-scoped. See
the design spec (`§ Investor (slice 2)`).

## Goal

Every Investor-domain producer aggregate has a producer-owned zod contract typing both the row
(`TableEntry<Subject>`) and the event (`BusEvent<Subject>`), validated against the real emitted shape.

## Scope

- **investor-ctrl** — extend beyond `NotificationCreated` to the rest of the notification +
  monthly-report lifecycle.
- **investor-bff** — extend beyond `InvestorProfileUpdated` to the remaining lifecycle CDC events.
- **onboarding-bff** — confirm coverage (already exports two contracts).
- Home rule: intra-domain consumers import producer `@nestfolio/<svc>/contracts`; cross-domain
  consumers of Investor events import the producer-domain re-export `@nestfolio/investor-adpt/domain`.

## Done

Every Investor event a publisher/consumer touches has a producer contract; rows are
`TableEntry<Subject>` (no inline row types); producers' unit tests + `tsc` green.

## Validation (THE #1 risk)

Scoped e2e against deployed dev asserts each contract matches the **REAL** emitted shape, **not
fixtures** ([[event-subject-contracts]]). Producer unit tests + `tsc` green.

## Deps

Phase-0 (`typed-subject-platform-context-taxonomy`) — needs the context taxonomy + constrained
`TableEntry<Subject>`.
