---
id: typed-subject-contracts-investor
status: active
type: refactor
notes: "Investor domain slice (slice 2) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Investor (slice 2)'). All tenant-scoped. investor-ctrl: extend beyond NotificationCreated to the rest (notification + monthly-report lifecycle). investor-bff: extend beyond InvestorProfileUpdated to the remaining lifecycle CDC events. onboarding-bff: confirm coverage (already has two contracts). Home rule: intra-domain consumers import producer <svc>/contracts; cross-domain consumers of investor events import via the producer-domain adapter investor-adpt/domain. Depends on phase-0 (typed-subject-platform-context-taxonomy). Validation: producer unit tests + tsc green + scoped e2e asserting the producer emits exactly what each contract declares (real DDB row / captured CDC subject, NOT fixtures — [[event-subject-contracts]]). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "WS-2 (cdc-publisher-typed-subjects): typing the CDC event-publisher Lambda's stream rows / emission seam — separate ranked workstream."
  - "WS-3 (consumer-parse-subject): converting consumer `as Record<string,unknown>` reads to parseSubject(producer schema) — separate ranked workstream. This slice only adds the producer contracts + types producer rows + the e2e gate."
  - "The enforcement capstone (typing-convention-enforcement-skills-docs)."
  - "Other domains: Ledger (shipped), Execution + Advisory (their own slices)."
  - "DEPOSIT_INITIATED / WITHDRAWAL_INITIATED contracts — already owned in investor-adpt/domain (cross-domain producer-adapter precedent); no change."
  - "onboarding-bff internal OnboardingSession session-state row — not a CDC-emitted aggregate; onboarding-bff is confirm-coverage only (its two existing contracts)."
  - "Runtime changes to emitted context payloads beyond what typing requires."
spec: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
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
`TableEntry<Subject>`. **Verified shipped on main 2026-06-09**: `SubjectContext`/`RegionContext`/
re-based `RequestContext` in `libs/event-processor/src/domain/schemas.ts`; both `BusEvent<T,S>`
(`platform/bus.ts`) and `TableEntry<T,S>` (`platform/table.ts`) constrained to `SubjectContext`
(default `RequestContext`); `parseSubject` (`util/parse-subject.ts`) + a context-taxonomy type-test.
Slice 1 (`typed-subject-contracts-ledger`) shipped the replicable template: contracts in
`src/domain/contracts.ts`, rows as `TableEntry<Subject,S>`, and the #1-risk e2e gate via
`expectContractMatch(schema, realDdbRow, label)` (`apps/e2e-feature-tests/src/helpers/contract-assert.ts`).

## Out of scope

- **WS-2 (`cdc-publisher-typed-subjects`)** — typing the CDC event-publisher Lambda's stream rows /
  emission seam. Separate ranked workstream.
- **WS-3 (`consumer-parse-subject`)** — converting consumer `as Record<string,unknown>` reads to
  `parseSubject(producer schema)`. Separate workstream. This slice only adds the producer contracts,
  types the producer rows, and proves them with the e2e gate.
- The enforcement capstone (`typing-convention-enforcement-skills-docs`).
- Other domains: Ledger (shipped), Execution + Advisory (their own slices).
- `DEPOSIT_INITIATED` / `WITHDRAWAL_INITIATED` contracts — already owned in `investor-adpt/domain`
  (the cross-domain producer-adapter precedent); no change.
- onboarding-bff's internal `OnboardingSession` session-state row — not a CDC-emitted aggregate;
  onboarding-bff is confirm-coverage only (its two existing contracts).
- Runtime changes to emitted **context** payloads beyond what typing requires.
