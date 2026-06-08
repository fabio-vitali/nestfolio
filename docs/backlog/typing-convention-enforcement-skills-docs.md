---
id: typing-convention-enforcement-skills-docs
status: queued
rank: 3
type: tooling
notes: "Prevent regressions of the kind event-subject-payload-build-tripwire fixed by CODIFYING + ENFORCING the typing conventions in the create-*/audit-* skills + architecture docs + (optionally) a check-script. Five conventions to enforce: (1) EVENT SUBJECTS — read-model transforms type the subject via parseSubject + an imported producer-owned zod contract; NEVER `event.subject as <LocalType>`/`as Record<string,unknown>` + a locally re-declared payload type. (2) CONTRACT-HOME / IMPORT RULE — intra-domain: consumer imports the producer's `<svc>/contracts` directly (service→service OK); cross-domain: the contract lives in the PRODUCER's domain adapter `/domain` (the ProposedTrade precedent) and the consumer imports from the adapter — NEVER two services importing each other's `/contracts` directly (that created the broker-ctrl↔investor-bff project cycle this workstream had to fix). (3) ROW + EVENT SHARE ONE SUBJECT TYPE — BusEvent<T> (platform/bus.ts) and TableEntry<T> (platform/table.ts) are generic over the SAME T by design; the producer Subject contract types BOTH the event (BusEvent<T>) AND the persisted row (TableEntry<T>) — rows should be TableEntry<Subject>, not a hand-rolled interface; 2026-06-08 audit found 8 row types re-declaring pk/sk/__typename inline instead (TaxLot, SnapshotRecord, SecFiling, decision-workflow InvestorProfileSnapshotProjectionRow + MarketSnapshotProjectionRow, investor-profile-ctrl InvestorProfileSnapshotRow, market-intelligence-ctrl MarketSnapshotRow, portfolio-engine + advisory-narrative AgentCompletionRow/AgentFailureRow). (4) CLEAN MODEL NAMES — contracts named after the clean domain/event concept, NO `Subject` suffix (`<Name>Schema` + `<Name>` type); on clash prefer the event-aligned name (LedgerEntryRecorded not LedgerEntry; InvestorProfileUpdated not InvestorProfile). (5) CONTEXT GENERIC S — parameterize the second generic `S` of BOTH BusEvent<T,S> and TableEntry<T,S> with `RequestContext` (or a domain extension), for event AND row consistently; never drop it. create-* skills should scaffold all five correctly; audit-* skills should FLAG violations; arch docs (SYSTEM-ARCHITECTURE, agent-system, cdk-patterns, create-service/create-event SKILL.md) document the rules; consider a tools/ check-script (like check-read-model-drift.mjs) wired into pre-commit/CI. Filed 2026-06-08 at user request after the typing workstream. May warrant a brief design pass on enforcement mechanism (skill-prose vs lint-rule vs both)."
references:
  - "docs/superpowers/specs/2026-06-07-event-subject-payload-build-tripwire-design.md"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Enforce typing + contract-import conventions in skills + arch docs

## Why

The `event-subject-payload-build-tripwire` workstream established several conventions
but nothing yet PREVENTS future code from regressing them. Two real regressions
already happened *during* that workstream and had to be caught by hand / by lint:
a cross-domain **project cycle** (broker-ctrl↔investor-bff, from two services
importing each other's `/contracts`), and the original anti-pattern itself (untyped
`event.subject as <LocalType>` casts). This item makes the conventions self-enforcing.

## The conventions to codify + enforce

1. **Event Subjects → `parseSubject` + imported producer contract.** A read-model
   transform/handler reads the subject via `parseSubject(uow_or_payload, Schema)`
   where `Schema` is the producer's exported zod contract. NEVER
   `event.subject as <LocalPayloadType>` / `as Record<string,unknown>` with a
   locally re-declared payload type. (Genuinely-polymorphic readers — KB text
   builders, activity feeds — use a documented consumer-owned view schema, not a
   raw cast.)

2. **Contract-home / import rule (intra vs cross-domain).**
   - **Intra-domain:** the consumer imports the producer's `@nestfolio/<svc>/contracts`
     **directly** (service→service is fine within a domain).
   - **Cross-domain:** the contract lives in the **producer's domain adapter
     `/domain`** (the `ProposedTrade`/`advisory-adpt/domain` precedent); the
     cross-domain consumer imports from the adapter. NEVER two services importing
     each other's `/contracts` directly — that creates a project cycle.

3. **One Subject type → both `BusEvent<T>` and `TableEntry<T>`.** `BusEvent<T,S>`
   (`platform/bus.ts`, `subject: T`) and `TableEntry<T,S>` (`platform/table.ts`,
   `T &` the pk/sk/__typename/createdAt envelope) are generic over the **same** `T`
   (Subject) + `RequestContext` **by design** — the same domain data lives in the
   event AND in the row. So the producer-owned Subject contract is the single source
   of truth for **both**: type the event as `BusEvent<TheSubject>` and the persisted
   row as `TableEntry<TheSubject>`. DDB row types should be `TableEntry<TheSubject>`,
   NOT a hand-rolled interface re-declaring `pk`/`sk`/`__typename` inline — reuse the
   Subject contract (or, where there's no event, a plain `TableEntry<{...fields}>`).
   The 8 bypasses below should each become `TableEntry<…>`, reusing the relevant
   contract where one exists (e.g. `InvestorProfileSnapshotRow` →
   `TableEntry<InvestorProfileSnapshot>`).

4. **Clean model names — NO `Subject` (or other noise) suffix.** A contract is named
   after the clean domain/event concept: schema `<Name>Schema`, inferred type `<Name>`
   — NOT `<Name>SubjectSchema` / `<Name>Subject`. (This workstream initially mis-suffixed
   every contract `…Subject` and had to rename them to `BalanceUpdated`, `PortfolioUpdated`,
   `MarketSnapshot`, `InvestorProfileSnapshot`, `NotificationCreated`, `DepositInitiated`,
   `WithdrawalInitiated`, `LedgerEntryRecorded`, `InvestorProfileUpdated`,
   `SimDepositCompleted`.) Where the clean name clashes, prefer the **event-aligned**
   name: `LedgerEntryRecorded` not `LedgerEntry` (clashes with the event-processor
   sourcing `LedgerEntry`); `InvestorProfileUpdated` not `InvestorProfile` (clashes with
   the investor-bff domain model).

5. **Context generic `S` = `RequestContext` (or an extension).** Both `BusEvent<T,S>`
   and `TableEntry<T,S>` take the request context as their second generic `S`
   (default `RequestContext` — tenantId/userId/region). Always parameterize `S` with
   `RequestContext` (or a domain extension of it) for BOTH the event AND the row, so the
   request context is carried consistently end-to-end; never drop it or substitute an
   ad-hoc context type.

## Work

- **`create-event` / `create-service` / `create-feature` skills:** scaffold a
  producer-owned zod Subject contract + the consumer `parseSubject` usage; place the
  contract per the intra/cross-domain rule; type new rows as `TableEntry`.
- **`audit-service` / `audit-domain` skills:** FLAG (a) `event.subject as …` casts +
  locally re-declared payload types in transforms; (b) cross-domain service→service
  direct `/contracts` imports (cycle risk); (c) row types bypassing `TableEntry`.
- **Architecture docs:** document conventions 1–3 in `SYSTEM-ARCHITECTURE.md`,
  `agent-system.md`, `cdk-patterns`, and the `create-service`/`create-event` `SKILL.md`.
  (Source-of-truth detail already in the project memory `project-event-subject-contracts`.)
- **Optional check-script:** a `tools/` checker (mirroring `check-read-model-drift.mjs`)
  asserting no new untyped subject casts in transforms, no cross-domain service↔service
  contract cycles, and `TableEntry` on row types — wired into pre-commit / CI.

## Current `TableEntry` bypasses to standardise (audit 2026-06-08)

`TaxLot` (ledger-ctrl/repositories/ledger.repository.ts), `SnapshotRecord`
(ledger-ctrl/transforms/snapshot-to-events.ts), `SecFiling` (sec-edgar-adpt/domain/events.ts),
`InvestorProfileSnapshotProjectionRow` + `MarketSnapshotProjectionRow`
(decision-workflow-ctrl/domain/models.ts), `InvestorProfileSnapshotRow`
(investor-profile-ctrl/domain/models.ts), `MarketSnapshotRow`
(market-intelligence-ctrl/domain/models.ts), `AgentCompletionRow`/`AgentFailureRow`
(portfolio-engine-ctrl + advisory-narrative-ctrl/domain/models.ts).
Note: event-Subject zod schemas that carry pk/sk for CDC are NOT rows — leave them.

## Note

May warrant a brief design pass on the enforcement mechanism (skill-prose guidance vs
a hard lint/check-script vs both) before implementation.
