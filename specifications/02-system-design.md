# System Design

How Nestfolio works at a business level. For service inventory and implementation details, see service cards and code.

---

## Domains

Four DDD domains, each with its own event bus. Communication between domains is exclusively asynchronous events -- no inter-service API calls.

| Domain | Responsibility |
|---|---|
| **Investor** | Identity, onboarding, goals, risk profiles, mandates, operating modes, notifications |
| **Advisory** | AI-driven decision lifecycle, compliance validation, guardrail enforcement, audit trail |
| **Execution** | Order lifecycle, broker integration, trade execution |
| **Ledger** | Financial truth, event-sourced accounts, portfolio projections, reconciliation |

## Service Taxonomy

Services follow a suffix convention encoding their architectural role:

| Suffix | Role |
|---|---|
| `-bff` | Backend-for-Frontend. One BFF = one feature = one actor. Owns API surface via GraphQL. |
| `-ctrl` | Controller. Async processing pipelines triggered by domain events. No API surface. |
| `-adpt` | Adapter. Anti-corruption layer bridging external systems or inter-domain translation. |
| `-hub` | Event Hub. Owns the domain's EventBridge bus and event archive. No business logic. |
| `-web` | Web frontend infrastructure. |

**Cross-domain routing uses an adapter pull model**: each domain's adapter owns its EventBridge subscriptions and decides which events from other domains to consume. The consumer domain defines what it needs, not the producer.

---

## Agent Architecture

Nestfolio uses a **Governed Multi-Agent Architecture**:

- **Orchestrator** -- deterministic workflow controller. Routes events to agents, enforces step ordering, produces Decision Packets. No AI reasoning.
- **Intelligence Agents** -- stateless, event-activated, horizontally scalable. Organized into categories: goal/profile analysis, market intelligence, portfolio strategy, communication. They propose actions but cannot execute.
- **Compliance Agent** -- mandatory gate between advisory and execution. Validates against mandate, suitability, guardrails. Enforces L1-to-L2 escalation.
- **Execution Agent** -- sole component authorized to submit orders (Single Writer Principle).
- **Reconciliation Agent** -- compares internal projections against broker settlement truth.

### Context Bundle

Each agent receives a curated bundle: triggering event, portfolio snapshot, mandate context, guardrail policy, market signals, prior decisions, model versions, account mode. The bundle is deterministic, minimal, immutable, and cost-contained.

### Decision Packet

Every portfolio-impacting change produces an immutable Decision Packet containing: trigger, portfolio context, mandate context, proposed actions, trade plan, risk checks, cost checks, reasoning factors, authority level, compliance decision, and execution outcome.

---

## Decision Lifecycle

```
1. Trigger Event (drift, deposit, goal change, scheduled)
2. Orchestrator routes to analysis agents
3. Agents emit proposals
4. Orchestrator composes Decision Packet
5. Compliance Agent authorizes or blocks
6. User confirmation (if L2)
7. Execution Agent submits orders
8. Fills/rejections recorded
9. Projections update; user receives explanation
```

---

## Portfolio Management

### Dual Truth Model

| Truth | Owner | Represents |
|---|---|---|
| Intent | Nestfolio (Event Store) | Decisions, trade plans, expected state |
| Settlement | Broker | Actual holdings, cash, corporate actions |

Settlement truth always prevails. Divergence triggers reconciliation. In Simulation mode, both truths are internal (single truth).

### Rebalancing

Triggered by: drift beyond threshold, scheduled cadence, material events (deposits, goal changes), or market regime shifts. Anti-thrashing via cool-down periods and turnover caps per operating mode.

### Broker Integration

Abstracted behind an adapter. The adapter emits identical events regardless of account mode -- no downstream service can distinguish live from simulated fills. Credential isolation: platform-managed, tenant-scoped secrets vault. User never interacts with broker directly.

### Reconciliation

Runs post-execution, hourly, daily, and on startup. Drift detection triggers: reconciliation lock, execution pause, snapshot import, projection correction, compliance revalidation, resume. Never-double-trade guarantees via decision/order idempotency keys.

### Circuit Breakers

Execution pauses when: volatility exceeds threshold, sync mismatch detected, data feeds unavailable, compliance fails. Recovery requires resynchronization, compliance revalidation, and user confirmation (severity-dependent).

---

## AI Reasoning Persistence

**Dual Layer Model**: structured Reasoning Factors stored at decision time (not chain-of-thought). Explanations can be replayed deterministically or enhanced via LLM using stored factors as bounded context. Model upgrades never alter historical intent.

## Cost Control

Three reasoning tiers (Minimal/Standard/Deep) selected dynamically. Per-tenant and global budgets. Degraded mode when budgets exceeded: safety checks continue, non-critical analysis paused.
