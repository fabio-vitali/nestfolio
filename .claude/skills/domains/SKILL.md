---
name: domains
description: Domain boundaries, responsibilities, event topology, and cross-domain adapters. Use when reasoning about domain interactions or cross-service flows.
---

## When This Skill Applies
- Adding or modifying cross-domain events
- Designing a flow that spans multiple domains
- Debugging event routing issues
- Understanding which domain owns what

## Where to Read (canonical sources)

This skill is intentionally thin. Per-domain service lists and event lists drift on every system change, so they live in the architecture docs and code, not here.

1. **`docs/architecture/SYSTEM-ARCHITECTURE.md` §4 (High-Level System Domains)** + **§18 (Cross-Domain Routing)** — domain responsibilities + adapter rules + pull-model rationale.
2. **`docs/architecture/SERVICE-INVENTORY.md`** — per-domain sections (`## Investor Domain`, `## Advisory Domain`, etc.) list services within each domain with health tags + per-service responsibility.
3. **Cross-domain event lists (canonical, code):**
   - Cross-domain producer events: `services/{domain}/{domain}-adpt/src/domain/events.ts`
   - Domain-internal events: `services/{domain}/{domain}-ctrl/src/domain/events.ts`
   - Adapter ingestion subscriptions: `services/{domain}/{domain}-adpt/src/service.stack.ts` (Ingress `eventTypes` arrays)
4. **`flows/*.flow.yaml`** — end-to-end traversal of business flows. Use to see the full event chain across domains in a single view. Validated against code by the `validate-flow` skill.

## Stable Topology (low-drift, fine to keep inline)

- **4 EventBridge buses** (one per domain: `InvestorBus`, `AdvisoryBus`, `ExecutionBus`, `LedgerBus`)
- **4 cross-domain adapters** (`*-adpt`), one per domain
- **Pull model**: each adapter deploys EB rules on FOREIGN buses to ingest events into its OWN bus. The producer never knows who consumes.
- **No direct service-to-service calls** — all communication via events on the domain bus.

## Anti-Patterns
- NEVER route events directly between services — always through the domain bus + adapter
- NEVER add cross-domain ingestion rules to a non-adapter service
- NEVER create event types without registering them in the producer's `events.ts`
- NEVER publish cross-domain events from a service that isn't the named producer (`*-adpt` for ingestion forwarding, primary `*-ctrl` for domain-owned events)
- **NEVER enumerate per-service event lists in this skill** — those drift on every change. Read the producer's `events.ts` or the service's `CLAUDE.md` card.
