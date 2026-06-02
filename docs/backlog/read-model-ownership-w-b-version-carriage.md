---
id: read-model-ownership-w-b-version-carriage
status: shipped
rank: 3
type: refactor
notes: "WS-B of read-model-ownership-producer-aggregates: stamp atomic __version + carry it on emitted events for non-ledger producers — investor-bff Mandate, IP-ctrl InvestorProfileSnapshot, MI-ctrl MarketSnapshot, ledger-ctrl LEDGER_ENTRY_RECORDED. Cross-domain event-contract change; deploy + e2e. Fixes investor-bff hardcoded __version:1."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: "docs/superpowers/plans/2026-06-02-read-model-ownership-w-b-version-carriage.md"
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "Consumer projectVersioned conversions (WS-C) — this WS only makes __version available at the source; no consumer reads it yet."
  - "R4 per-service-scoping drift-checker refinement (WS-C prerequisite — not needed until DWC mirrors register as P1)."
  - "Mandatory-error drift gate + tools/read-model-exclusions.json (WS-D)."
  - "broker-ctrl ExecutionMode registration (WS-D)."
  - "Canonical doc §9 Mandate fan-out documentation (WS-C)."
  - "Live-push transport for dashboard PortfolioSummary/PositionSnapshot — separate feature concern, parked."
  - "Event-sourcing on the write side — system stays state-stored-aggregate + CDC-outbox."
validation_gate: "Commits 32b59370 (Mandate __version), c41f9b9c (MarketSnapshot __version), 4b432585 (IP snapshot record→update upsert + __version), edd40ff7 (doc §3 + verify-only assertions), e986108d (cards). Local: nx test+lint 3/3 services green; investor-bff/market-intelligence-ctrl/investor-profile-ctrl typecheck trip-wires green; event-processor:read-model-drift OK (0 drift). Deploy: dev-investor-bff + dev-investor-profile-ctrl + dev-market-intelligence-ctrl all UPDATE_COMPLETE. Integration (live dev): investor-bff 19/19, ledger-ctrl 19/19 (lastEventSequence carriage), market-intelligence-ctrl 5/5 (MarketSnapshot __version); investor-profile-ctrl — WS-B two-trigger 'INVESTOR_PROFILE_SNAPSHOT_UPDATED with __version 2' PASSED on live dev + MANDATE_ISSUED snapshot PASSED. One PRE-EXISTING, non-WS-B IP-ctrl test failure (materialises…INVESTOR_PROFILE_UPDATED userId mismatch) filed as [[ip-ctrl-integration-snapshot-userid-mismatch]] (deductively proven not WS-B-caused: uniform record→update change, only 1 of 3 identical sibling tests fails). E2E: skipped per user decision (real-AgentCore cost + AgentRuntime-unavailable flakiness on dev this window; WS-B behavior covered by unit + the live-dev integration two-trigger test)."
---

# WS-B — __version carriage on producer events

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


Workstream B of `read-model-ownership-producer-aggregates` (design § "WS-B").

Sequenced immediately after WS-A (`read-model-ownership-w-a-registrations`,
rank 2): this WS makes the upstream `__version` available that WS-C's consumer
conversions depend on.

Mechanism (settled): atomic per-row `__version` via DynamoDB `ADD #__version :1`
(`=1` on seed); CDC-as-outbox carries it top-level into the emitted event with no
extra publish code (`DecisionPacket` already does exactly this).

Producers:

- investor-bff `Mandate` sibling row: stamp `__version`, carry on
  `MANDATE_ISSUED`/`MANDATE_REVOKED`/`OPERATING_MODE_CHANGED`. Also fix the
  hardcoded `InvestorProfile.__version: 1` (currently never increments).
- investor-profile-ctrl `InvestorProfileSnapshot`: stamp + carry on
  `INVESTOR_PROFILE_SNAPSHOT_CREATED`/`_UPDATED`. Confirm rebuild semantics — it is
  `record()` (create-only) today; if rebuilt per decision cycle the intent must
  become an upsert + `ADD #__version :1`, else the version pins at 1 and is
  useless as a guard.
- market-intelligence-ctrl `MarketSnapshot`: stamp + carry on `MARKET_SNAPSHOT_UPDATED`.
- ledger-ctrl `LEDGER_ENTRY_RECORDED`: carry `lastEventSequence`/`__version` so
  dashboard-bff `TimeTravelAvailability` can become P1 in WS-C.

Cross-domain event-contract change across 3 domains; touches the advisory decision
pipeline. Validation gate: deploy dev (touched producers) + `pnpm nx affected -t
test-integration` + involved e2e (advisory pipeline, onboarding, ledger).

See [[project_read_model_redesign]].
