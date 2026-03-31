# Inverted Adapter Event Routing (Pull Model)

**Date:** 2026-03-31
**Status:** Draft
**Motivation:** Consumer autonomy — each domain controls its own event subscriptions without requiring changes in the producing domain's adapter.

---

## Overview

Replace the current "push" cross-domain event routing pattern with a "pull" (ingestion) pattern. Instead of each adapter deploying EventBridge rules on its **own** domain bus to forward events **out** to other buses, each adapter deploys rules on **foreign** domain buses to ingest events **into** its own bus.

### Current (Push)

```
execution-adpt deploys:
  Rule on ExecutionBus → target: InvestorBus
  Rule on ExecutionBus → target: LedgerBus
  Rule on ExecutionBus → target: AdvisoryBus
```

### New (Pull)

```
investor-adpt deploys:
  Rule on ExecutionBus  → target: InvestorBus
  Rule on AdvisoryBus   → target: InvestorBus
  Rule on LedgerBus     → target: InvestorBus
```

The producing domain has zero awareness of who consumes its events. Consumers self-subscribe.

---

## 1. Event Flow Direction

Each `{domain}-adpt` resolves external bus ARNs via the existing `resolveBusArn()` helper, creates EB rules on those external buses filtered by `detailType`, and targets its own domain bus with a DLQ per source.

**Rule naming convention** (avoids collisions when multiple consumers create rules on the same foreign bus):

```
{ConsumerDomain}Ingress-From{ProducerDomain}
```

Example: `InvestorIngress-FromExecution` — rule created by `investor-adpt` on `executionBus`.

---

## 2. Hub Bus Resource Policy

`CrossAccountBusPolicy` currently grants only `events:PutEvents`. Update it to also grant rule-management actions:

```
actions:
  - events:PutEvents
  - events:PutRule
  - events:DeleteRule
  - events:PutTargets
  - events:RemoveTargets
  - events:DescribeRule
```

**Scope:** All accounts returned by `getConsumerAccountIds()` — not per-consumer. Adding a new consumer domain does not require redeploying the producer's hub.

**Single-account mode:** No resource policy needed — the deploying account already has full permission on its own buses.

**Implementation:** Update `CrossAccountBusPolicy` in `libs/cdk-constructs/src/extensions/cross-account.ts` to include rule-management actions alongside `PutEvents`. No backward-compatibility shim needed (system not yet deployed).

---

## 3. Adapter Stack Structure

Each adapter follows an identical pattern. Example for `investor-adpt`:

```typescript
// 1. Resolve own domain bus (target for all ingested events)
const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus',
  resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts));

// 2. Resolve external source buses
const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus',
  resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts));
const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus',
  resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts));
const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus',
  resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts));

// 3. Ingestion rule: Advisory → Investor
const fromAdvisoryDlq = new Queue(this, 'FromAdvisoryDLQ', {
  retentionPeriod: Duration.days(14),
  encryption: QueueEncryption.KMS_MANAGED,
});
new Rule(this, 'InvestorIngress-FromAdvisory', {
  eventBus: advisoryBus,                // rule on FOREIGN bus
  eventPattern: {
    detailType: [
      InvestorIngestEventTypes.DECISION_APPROVED,
      InvestorIngestEventTypes.RECOMMENDATION_READY,
    ],
  },
  targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromAdvisoryDlq })],
});

// 4. Repeat for Execution → Investor, Ledger → Investor
```

**Key structural changes:**
- `eventBus:` points to the foreign bus (source), not the local one
- Target is the local domain bus (consumer)
- DLQ naming: `From{Source}DLQ` instead of `To{Target}DLQ`
- Event type enums are consumer-owned (`InvestorIngestEventTypes`)

---

## 4. Event Contract & Discovery

- **Producer side:** Each hub domain's existing event type enums (e.g., `ExecutionCrossDomainEventTypes`) remain as documentation of what the domain emits. These are the public contract.
- **Consumer side:** Each adapter defines its own `IngestEventTypes` enum listing the external `detailType` values it subscribes to. These are string constants matching the producer's contract.
- **Robustness:** If a consumer subscribes to a `detailType` that doesn't exist, the rule simply never matches — no errors.
- No formal event catalog needed. The hub's event type enum is the source of truth for available events.

---

## 5. Monitoring & Observability

Each adapter's monitoring tracks **inbound** DLQs instead of outbound:

| Component | Convention |
|-----------|-----------|
| DLQ name | `From{Source}DLQ` (e.g., `FromAdvisoryDLQ`) |
| CloudWatch alarm | Alarm on DLQ `ApproximateNumberOfMessagesVisible > 0` |
| Dashboard | DLQ depths + consumer domain bus event count |

**Operational mental model:** "If `FromExecutionDLQ` has messages, events from ExecutionBus couldn't be delivered to InvestorBus." Debugging starts at the consuming adapter, which owns the rule.

---

## 6. Migration Strategy

Since the system has not been deployed yet, this is a clean swap with no dual-write period:

1. **Update `CrossAccountBusPolicy`** — add rule-management actions (`PutRule`, `DeleteRule`, `PutTargets`, `RemoveTargets`, `DescribeRule`) alongside `PutEvents`
2. **Rewrite each adapter stack** — from push (rules on own bus → foreign target) to pull (rules on foreign bus → own target)
3. **Create consumer-owned event type enums** — `IngestEventTypes` per adapter; retire `CrossDomainEventTypes` from producer adapters
4. **Update adapter CLAUDE.md service cards** — reflect new ingestion direction
5. **Update domain READMEs** — document pull pattern
6. **Update C4 diagrams** — reflect new flow direction (arrows flip from "adapter pushes to X" to "adapter pulls from X")

---

## 7. Affected Files

### CDK Constructs (shared library)
- `libs/cdk-constructs/src/extensions/cross-account.ts` — update `CrossAccountBusPolicy` actions

### Adapter Stacks (one per domain)
- `services/investor/investor-adpt/src/service.stack.ts`
- `services/advisory/advisory-adpt/src/service.stack.ts`
- `services/execution/execution-adpt/src/service.stack.ts`
- `services/ledger/ledger-adpt/src/service.stack.ts`

### Event Type Definitions (new consumer-owned enums)
- `services/investor/investor-adpt/src/domain/events.ts`
- `services/advisory/advisory-adpt/src/domain/events.ts`
- `services/execution/execution-adpt/src/domain/events.ts`
- `services/ledger/ledger-adpt/src/domain/events.ts`

### Documentation
- `services/*/CLAUDE.md` — adapter service cards
- `docs/domains/*.md` — domain READMEs
- C4 diagram sources

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Full replacement, no hybrid | System not yet deployed — no migration burden |
| Broad resource policy (all org accounts) | Avoids coupling; adding a consumer doesn't require redeploying the producer hub |
| Consumer-owned event type enums | Reinforces autonomy — consumer defines what it needs, not what the producer offers |
| Events land on consumer's domain bus | Preserves existing Ingress handler paths; adapter stays pure routing infrastructure |
| No formal event catalog | Hub event type enums serve as documentation; lightweight for current scale |
