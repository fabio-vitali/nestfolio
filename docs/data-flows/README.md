# Data Flows

This directory documents the end-to-end data flows for every major feature in Nestfolio. Each flow traces a user action or system trigger through the full event-driven pipeline — from the originating domain, across EventBridge buses, through controllers, adapters, and into read models.

## Architecture Context

Nestfolio is organized into **4 domains** communicating asynchronously via **EventBridge buses**:

| Domain | Bus | Responsibilities |
|--------|-----|-----------------|
| **Investor** | InvestorBus | Onboarding, deposits, withdrawals, notifications, investor profile |
| **Advisory** | AdvisoryBus | AI-driven decision cycles, compliance checks, market data ingestion |
| **Execution** | ExecutionBus | Order execution, broker integration, cross-domain event forwarding |
| **Ledger** | LedgerBus | Event-sourced order recording, portfolio snapshots, reconciliation, simulation |

**Cross-domain communication** follows a strict pattern: adapter services (`*-adpt`) forward events between buses. No service directly publishes to another domain's bus.

**Event sourcing** (CDC via DynamoDB Streams) is the primary event emission mechanism: services persist state to DynamoDB, and Change Data Capture publishes corresponding domain events to EventBridge.

## Flow Categories

### Investor Lifecycle
| # | Flow | Trigger | Domains Involved |
|---|------|---------|-----------------|
| 01 | [Investor Onboarding](./01-investor-onboarding.md) | User completes onboarding wizard | Investor, Advisory |
| 02 | [Deposit](./02-deposit.md) | User initiates a deposit | Investor, Execution, Advisory, Ledger |
| 03 | [Withdrawal](./03-withdrawal.md) | User requests a withdrawal | Investor, Execution, Ledger |
| 04 | [Notification Delivery](./04-notification-delivery.md) | Domain event requires user notification | All domains -> Investor |

### Portfolio & Dashboard
| # | Flow | Trigger | Domains Involved |
|---|------|---------|-----------------|
| 05 | [Portfolio Dashboard](./05-portfolio-dashboard.md) | User opens the dashboard | Investor (read models from all domains) |
| 09 | [Order Ledger / Event Sourcing](./09-order-ledger.md) | Execution events + advisory decision packets | Execution, Advisory, Ledger (dual-stream) |
| 10 | [Time-Travel Query](./10-time-travel-query.md) | User selects a past timestamp | Ledger (synchronous query) |
| 11 | [Simulation Comparison](./11-simulation-comparison.md) | User opens the comparison view | Advisory, Ledger |
| 14 | [Reconciliation](./14-reconciliation.md) | Portfolio update triggers reconciliation | Ledger |

### Advisory & Compliance
| # | Flow | Trigger | Domains Involved |
|---|------|---------|-----------------|
| 06 | [Advisory Decision Cycle](./06-advisory-decision-cycle.md) | 1 of 9 domain events triggers decision lifecycle | Advisory (5 services + Step Functions), Compliance, Execution |
| 07 | [Market Data Ingestion](./07-market-data-ingestion.md) | EventBridge Scheduler (daily) | Advisory |
| 12 | [Compliance Check](./12-compliance-check.md) | Decision packet created or enriched | Advisory (Compliance) |

### Execution & Rebalancing
| # | Flow | Trigger | Domains Involved |
|---|------|---------|-----------------|
| 08 | [Order Execution](./08-order-execution.md) | Advisory decision approved | Advisory, Execution, Ledger, Investor |
| 13 | [Portfolio Rebalancing](./13-portfolio-rebalancing.md) | Drift detected between actual and target allocations | Ledger, Advisory, Execution |

## Reading the Flows

Each document follows a consistent structure:

1. **Trigger** — what initiates the flow
2. **Flowchart** — Mermaid diagram showing the full event chain with domain-colored nodes
3. **Summary Table** — step-by-step breakdown: component, domain, input/output events, and target bus

### Color Legend (Mermaid diagrams)

| Color | Domain |
|-------|--------|
| Blue (`#D6E4FF`) | Investor |
| Green (`#D6FFD9`) | Advisory |
| Dark green (`#C6F0C6`) | LangGraph Agent |
| Orange (`#FFE2D6`) | Execution |
| Yellow (`#FFF5CC`) | Ledger |
| Peach (`#FFEEDD`) | Simulated stream |
| Pink (`#FFD6E8`) | Compliance |
| Purple (`#E8D6FF`) | Orchestrator / Scheduler |
| Lavender (`#E6E6FF`) | Read Models |
| Light gray (dashed) | EventBridge Bus |
| Gold (`#FFF0AA`) | Decision point |
| White | User |
