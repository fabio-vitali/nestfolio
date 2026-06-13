---
id: typing-convention-enforcement-skills-docs
status: shipped
rank: 9
type: tooling
notes: "Prevent regressions of the kind event-subject-payload-build-tripwire fixed by CODIFYING + ENFORCING the typing conventions in the create-*/audit-* skills + architecture docs + (optionally) a check-script. Five conventions to enforce: (1) EVENT SUBJECTS — read-model transforms type the subject via parseSubject + an imported producer-owned zod contract; NEVER `event.subject as <LocalType>`/`as Record<string,unknown>` + a locally re-declared payload type. (2) CONTRACT-HOME / IMPORT RULE — intra-domain: consumer imports the producer's `<svc>/contracts` directly (service→service OK); cross-domain: the contract lives in the PRODUCER's domain adapter `/domain` (the ProposedTrade precedent) and the consumer imports from the adapter — NEVER two services importing each other's `/contracts` directly (that created the broker-ctrl↔investor-bff project cycle this workstream had to fix). (3) ROW + EVENT SHARE ONE SUBJECT TYPE — BusEvent<T> (platform/bus.ts) and TableEntry<T> (platform/table.ts) are generic over the SAME T by design; the producer Subject contract types BOTH the event (BusEvent<T>) AND the persisted row (TableEntry<T>) — rows should be TableEntry<Subject>, not a hand-rolled interface; 2026-06-08 audit found 8 row types re-declaring pk/sk/__typename inline instead (TaxLot, SnapshotRecord, SecFiling, decision-workflow InvestorProfileSnapshotProjectionRow + MarketSnapshotProjectionRow, investor-profile-ctrl InvestorProfileSnapshotRow, market-intelligence-ctrl MarketSnapshotRow, portfolio-engine + advisory-narrative AgentCompletionRow/AgentFailureRow). (4) CLEAN MODEL NAMES — contracts named after the clean domain/event concept, NO `Subject` suffix (`<Name>Schema` + `<Name>` type); on clash prefer the event-aligned name (LedgerEntryRecorded not LedgerEntry; InvestorProfileUpdated not InvestorProfile). (5) CONTEXT GENERIC S — parameterize the second generic `S` of BOTH BusEvent<T,S> and TableEntry<T,S> with `RequestContext` (or a domain extension), for event AND row consistently; never drop it. create-* skills should scaffold all five correctly; audit-* skills should FLAG violations; arch docs (SYSTEM-ARCHITECTURE, agent-system, cdk-patterns, create-service/create-event SKILL.md) document the rules; consider a tools/ check-script (like check-read-model-drift.mjs) wired into pre-commit/CI. Filed 2026-06-08 at user request after the typing workstream. May warrant a brief design pass on enforcement mechanism (skill-prose vs lint-rule vs both)."
references:
  - "docs/superpowers/specs/2026-06-07-event-subject-payload-build-tripwire-design.md"
  - "docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md"
out_of_scope:
  - "Re-converting the 8 TableEntry-bypass row types — already done by WS-1/2/3 (typed-subject-producer-contracts and its domain slices); verified 2026-06-12."
  - "Removing the documented exception subject-casts: broker-ctrl funding normalizer x4 (owned by broker-funding-completed-normalization-drift), KB-stringify fan-in, ledger ORDER_FILLED boundary, polymorphic agent fan-in (upstreamOutputs). These are legitimate documented exceptions to be REGISTERED in the exclusion list, not rewritten here."
  - "Platform-internal generic seams in libs/event-processor (to-uow.ts, sqs-parser.ts, ingestion-engine.ts) — the parseSubject carrier itself is Record<string,unknown> by design; the checker must not flag these."
  - "FUNCTIONAL / behavior changes to services — the 11 cross-domain import repointings (route ledger-ctrl + investor-bff cross-consumed symbols via ledger-adpt/domain + investor-adpt/domain) are TYPE-ONLY re-export changes, behavior-identical; no logic/handler/CDK-rule changes, no e2e behavior to assert."
  - "Convention 5 (context generic S) mechanical enforcement — skills/docs only (not cleanly mechanizable)."
  - "The CLAUDE.md service-card-drift gate — split to its own backlog item (decided 2026-06-12); not built here."
  - "Boundary adapters' own pull-subscription cross-domain event-name imports, if any surface — exception class (test override / targeted allow), not a forced reroute."
spec: "docs/superpowers/specs/2026-06-12-typed-subject-enforcement-design.md"
plan: "docs/superpowers/plans/2026-06-12-typed-subject-enforcement.md"
topic_memory: ["project_event_subject_contracts.md"]
validation_gate: "Shipped 2026-06-12 (worktree, commits 271e61bd..140f25cc, 19 commits). GATE: tools/check-typed-subjects.mjs (pure-Node, mirrors check-read-model-drift.mjs) enforces C1 (no untyped subject reads), C2 (cross-domain import channel), C4 (no Subject-suffix names), opaqueSubject-guard, C3-heuristic (inline pk/sk/__typename rows). `node tools/check-typed-subjects.mjs` → 'OK (30 raw hit(s), 13 excluded, 0 violation(s))'; nx target event-processor:typed-subject-drift PASS; node:test 15/15; exclusion registry = 13 audited documented-polymorphic readers (2 carry backlogRefs). Wired: nx target + daemon-free pre-commit Check 8 in verify-structure.sh. KEY DEVIATION (spec amendment 2026-06-12): convention 2 enforced by the CHECK-SCRIPT, NOT nx enforce-module-boundaries — empirically nx can't (services are Nx apps → 'imports of apps forbidden' fires on all 29+ intra-domain service→service imports; allow is not scope-aware). The check-script's cross-domain rule is scope-aware (service→domain map from layout); negative check FAIL→OK confirmed it bites. CODEBASE MADE COMPLIANT: 11 live cross-domain imports re-routed through ledger-adpt/domain + investor-adpt/domain (type-only, behaviour-identical); nx lint 8 affected projects 0 errors; 231 service unit tests green. DOCS: create-*/audit-* skills + SYSTEM-ARCHITECTURE.md + agent-system.md + cdk-patterns SKILL.md document conventions 1-5 + enforcement. SPLIT OUT: deterministic CLAUDE.md card-drift gate → service-card-drift-gate (queued, subsumes service-card-funding-event-type-drift). SIDE-FINDINGS FILED (parking): adapter-event-name-redeclare-vs-reexport; compliance-ctrl-mandate-snapshot-parse-subject (a genuine WS-3 consumer-conversion residual the new gate CAUGHT). NO DEPLOY (type-only/behaviour-identical, user-confirmed skip; detect-deploy false-positive per detect-deploy-tools-path-no-deploy). Conventions 3-full + 5 are skills/docs-only (not mechanically gated)."
---

> **Re-scoped 2026-06-09 (rank 3 → 4).** Now the ENFORCEMENT CAPSTONE of the typed-subject
> program: only the lint rule / check-script (forbid `as Record<string,unknown>` on subjects,
> bare subject casts, any reintroduced `opaqueSubject`) + create-*/audit-* skill + arch-doc
> updates. Runs AFTER WS-1/2/3 (`typed-subject-producer-contracts` → `cdc-publisher-typed-subjects`
> → `consumer-parse-subject`) so it locks in an already-compliant codebase. The 5 conventions
> below are what it enforces. Strategy: `docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md`.

# Enforce typing + contract-import conventions in skills + arch docs

> **SHIPPED 2026-06-12.** See `validation_gate` for evidence. As-built deviations from the
> plan below: (1) **convention 2 is enforced by `tools/check-typed-subjects.mjs`, NOT nx
> `enforce-module-boundaries`** — nx can't (services are Nx apps → apps-forbidden blocks
> intra-domain imports too); see the spec amendment in
> `docs/superpowers/specs/2026-06-12-typed-subject-enforcement-design.md`. (2) The 11 live
> cross-domain imports were re-routed through `*-adpt/domain` to make the codebase compliant
> (type-only). (3) The CLAUDE.md card-drift gate was **split out** to `service-card-drift-gate`
> (queued). (4) The gate caught a genuine WS-3 residual (`compliance-ctrl` mandate-snapshot
> raw read) → filed `compliance-ctrl-mandate-snapshot-parse-subject`; plus side-finding
> `adapter-event-name-redeclare-vs-reexport`. Full design+plan:
> `docs/superpowers/{specs,plans}/2026-06-12-typed-subject-enforcement*.md`.

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
- **Optional check-script(s):** a `tools/` checker (mirroring `check-read-model-drift.mjs`)
  asserting no new untyped subject casts in transforms, no cross-domain service↔service
  contract cycles, and `TableEntry` on row types — wired into pre-commit / CI.
- **Deterministic CLAUDE.md card-drift gate (folded in 2026-06-08; subsumes
  `service-card-funding-event-type-drift`).** Root cause of stale cards: `audit-service`
  regenerates them on-demand via an LLM read→rewrite with NO standing gate, so code
  silently drifts from the card (e.g. funding event-type renames left broker-ctrl /
  investor-adpt / investor-bff cards naming dead events). Add a deterministic checker
  (again mirroring `check-read-model-drift.mjs`) for the MECHANICALLY-derivable card
  sections — Ingress subscriptions, Egress `eventTypes` map, Handlers, Event Types, DDB
  entities — parsed from `service.stack.ts` / `events.ts` and diffed against the card;
  fail CI on mismatch. Prose/intent sections stay LLM-regenerated (not gated). Closes the
  *class* of bug, so the 3 stale cards get fixed when the gate lands.

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
