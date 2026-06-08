---
id: residual-generic-subject-casts-cleanup
status: queued
rank: 2
type: refactor
notes: "Surfaced 2026-06-08 closing event-subject-payload-build-tripwire. That workstream ELIMINATED the targeted anti-pattern (re-declared local payload type + `event.subject as <LocalType>` cast in read-model transforms → 0 remaining) and typed all ~21 census read-model transforms against producer-owned zod contracts via parseSubject. But ~27 GENERIC `as Record<string,unknown>` subject/payload casts remain across the repo that were NEVER in the census and are a different category — legitimate polymorphic/opaque/dynamic reads: (a) the advisory agent pipeline passing composite handoff state (portfolio-engine-ctrl + advisory-narrative-ctrl event-listeners read subject.investorProfile/marketAnalysis/portfolio as Record; IP/MI/PE/AN agent-service.ts read `(event.subject ?? event) as Record`); (b) KB text builders (investor-profile-ctrl + market-intelligence-ctrl kb-ingestion-handler.ts stringify arbitrary events into Bedrock-KB content); (c) dynamic-key derivation (investor-ctrl event-listener reads subject[idField] across many event types for the notification entity link, + an opaque orderDetails report blob in notification-lifecycle.service.ts); (d) decision-workflow sfn-callback subject.agentOutput; (e) execution-ctrl event-listener/order-lifecycle (already import the typed ProposedTrade from advisory-adpt/domain for the trades, generic Record for the envelope). PROMOTE-WHEN: the advisory inter-agent handoff payloads get a typed-contract design (relates to inter-agent-state-handoff) OR a specific one of these handlers needs payload-tripwire protection. Most are appropriately Record today (genuinely dynamic/composite). NOT e2e-blocking; quality refactor only. Separate from broker-funding-completed-normalization-drift (a real bug)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Residual generic subject-cast cleanup (assessment)

The `event-subject-payload-build-tripwire` workstream eliminated the
re-declared-payload-type anti-pattern in read-model transforms and proved the
payload build-tripwire. It did NOT eliminate every `as Record<string,unknown>`
subject read in the repo, because ~27 remaining ones are a different category:
genuinely polymorphic / opaque / dynamic reads that the census never targeted.

## The remaining casts (categorised)

- **Advisory agent pipeline — composite handoff state.** `portfolio-engine-ctrl`
  + `advisory-narrative-ctrl` event-listeners read `subject.investorProfile`,
  `subject.marketAnalysis`, `subject.portfolio` as `Record`; the four advisory
  `agent-service.ts` adapters read `(event.subject ?? event) as Record`. These have
  real shapes and COULD be typed — but that's the inter-agent handoff contract
  concern, a large distinct effort.
- **KB text builders.** `investor-profile-ctrl` + `market-intelligence-ctrl`
  `kb-ingestion-handler.ts` summarise arbitrary events (DECISION_*, 5 market feeds)
  into Bedrock-KB text. Polymorphic across many producers; appropriately opaque.
- **Dynamic-key derivation / opaque blobs.** `investor-ctrl` event-listener reads
  `subject[idField]` across many event types (notification entity link), and
  `notification-lifecycle.service.ts` stores the whole order subject as an opaque
  report blob.
- **Misc.** `decision-workflow-ctrl/sfn-callback.ts` `subject.agentOutput`;
  `execution-ctrl` event-listener / order-lifecycle (envelope Record; the trades
  themselves already use the typed `ProposedTrade` from `advisory-adpt/domain`).

## Scope / priority

Most are appropriately `Record` today (the data is genuinely dynamic/composite). The
highest-value subset (advisory agent handoff payloads) is really a typed-inter-agent-
handoff design, not a mechanical retype — that part should get a brief design pass rather
than a blind retype. Queued (rank 5, low priority) at the user's request after the
typing workstream: assess each handler, type the ones with a single producer + specific
reads, give the polymorphic feed/KB readers a consumer-owned view schema (like
recent-activity), and leave genuinely-opaque blobs as `Record`.
