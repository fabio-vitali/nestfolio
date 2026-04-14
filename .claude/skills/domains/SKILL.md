---
name: domains
description: Domain boundaries, responsibilities, event topology, and cross-domain adapters. Use when reasoning about domain interactions or cross-service flows.
---

## When This Skill Applies
- Adding or modifying cross-domain events
- Designing a flow that spans multiple domains
- Debugging event routing issues
- Understanding which domain owns what

## Prerequisites
- Read `orient` skill first if you need full system context

## Domain: Advisory
**Responsibility:** Investment decision-making — market intelligence, portfolio optimization, compliance, decision workflows
**EventBridge Bus:** AdvisoryBus
**Services:** advisory-ctrl, advisory-bff, advisory-hub, advisory-adpt, decision-workflow-ctrl, advisory-narrative-ctrl, compliance-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, alpha-vantage-adpt, fred-adpt, marketwatch-adpt, sec-edgar-adpt, yahoo-finance-adpt

**Events Produced (cross-domain — AdvisoryCrossDomainEventTypes):**
- `DECISION_PACKET_CREATED` — new decision packet ready (→ Investor + Ledger)
- `DECISION_APPROVED` — compliance approved decision (→ Investor + Execution)
- `USER_CONFIRMED` — investor confirmed proposed action (→ Execution only)
- `USER_CONFIRMATION_REQUESTED` — awaiting investor response (→ Investor only)
- `EXPLANATION_GENERATED` — narrative explanation ready (→ Investor only)
- `DECISION_BLOCKED` — compliance blocked decision (→ Investor only)
- `ESCALATION_TRIGGERED` — escalation initiated (→ Investor only)
- `CIRCUIT_BREAKER_TRIGGERED` — circuit breaker fired (→ Investor + Execution)
- `CIRCUIT_BREAKER_RESET` — circuit breaker cleared (→ Investor + Execution)
- `INCIDENT_DETECTED` — incident identified (→ Investor only)
- `INCIDENT_RESOLVED` — incident resolved (→ Investor only)

**Events Produced (domain-internal — AdvisoryCtrlEventTypes):**
- `AGENT_INVOCATION_STARTED`, `AGENT_INVOCATION_COMPLETED`, `AGENT_EXECUTION_FAILED`
- `GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `MARKET_SIGNAL_DETECTED`
- `PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `RECOMMENDATION_PROPOSED`
- `DECISION_PACKET_ENRICHED`, `INCIDENT_CONTAINED`, `INCIDENT_ESCALATED`
- `HEALTH_CHECK_COMPLETED`, `MODEL_REGISTERED`, `SHADOW_RUN_STARTED`, `SHADOW_RUN_COMPLETED`
- `MODEL_PROMOTION_REQUESTED`, `MODEL_PROMOTION_APPROVED`, `MODEL_PROMOTED`, `MODEL_ROLLBACK_TRIGGERED`
- `TENANT_BUDGET_APPROACHING`, `TENANT_BUDGET_EXCEEDED`, `REASONING_TIER_CHANGED`
- `OPERATOR_ACTION_PERFORMED`, `EVENT_DELIVERY_FAILED`, `EVENT_REPLAYED`

**Events Produced (decision-workflow-ctrl — DecisionWorkflowEventTypes):**
- `DECISION_PACKET_CREATED`, `DECISION_PACKET_ENRICHED`
- `ANALYZE_INVESTOR_PROFILE`, `ANALYZE_MARKET`, `CONSTRUCT_PORTFOLIO`, `GENERATE_NARRATIVE` (SF task triggers)
- `RECOMMENDATION_PROPOSED`, `USER_CONFIRMATION_REQUESTED`
- `DECISION_FEEDBACK`, `DECISION_WORKFLOW_FAILED`

**Events Consumed (decision-workflow-ctrl — inbound triggers):**
- Trigger (new SF execution): `MANDATE_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`
- Agent completions: `INVESTOR_PROFILE_COMPLETED`, `MARKET_ANALYSIS_COMPLETED`, `PORTFOLIO_COMPLETED`, `NARRATIVE_COMPLETED`
- Compliance: `DECISION_APPROVED`, `DECISION_BLOCKED`
- User response: `USER_CONFIRMED`, `USER_REJECTED`

**Adapter Ingestion (advisory-adpt — pull model):**
- InvestorBus → AdvisoryBus: `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_CREATED`, `MANDATE_UPDATED`
- ExecutionBus → AdvisoryBus: `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`
- LedgerBus → AdvisoryBus: `PORTFOLIO_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`

---

## Domain: Execution
**Responsibility:** Order routing, broker integration, order lifecycle management
**EventBridge Bus:** ExecutionBus
**Services:** execution-ctrl, execution-hub, execution-adpt, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt

**Events Produced (cross-domain — ExecutionCrossDomainEventTypes):**
- `ORDER_STAGED` — order staged for review (→ Investor)
- `ORDER_REJECTED` — order rejected by broker (→ Investor + Ledger + Advisory)
- `ORDER_CANCELLED` — order cancelled (→ Investor + Ledger + Advisory)
- `ORDER_ESCALATED` — order requires manual escalation (→ Investor)
- `BROKER_CIRCUIT_OPEN` — broker circuit breaker opened (→ Investor)
- `ORDER_FILLED` — order fully filled (→ Investor + Ledger + Advisory)
- `ORDER_PARTIALLY_FILLED` — order partially filled (→ Investor + Ledger)
- `DEPOSIT_DETECTED` — deposit confirmed at broker (→ Investor + Ledger + Advisory)
- `WITHDRAWAL_COMPLETED` — withdrawal completed (→ Investor + Ledger)
- `TRANSFER_FAILED` — transfer failed (→ Investor + Ledger)
- `CORPORATE_ACTION_APPLIED` — corporate action processed (→ Ledger)
- `PORTFOLIO_SNAPSHOT_IMPORTED` — full portfolio snapshot imported (→ Ledger)
- `ALPACA_ACCOUNT_SNAPSHOT` — Alpaca account snapshot (→ Ledger)

**Events Produced (execution-ctrl — ExecutionCtrlEventTypes):**
- `ORDER_SUBMITTED`, `ORDER_STAGED`, `EXECUTION_PAUSED`, `EXECUTION_RESUMED`

**Events Produced (broker-ctrl — BrokerCtrlEventTypes, normalized CDC):**
- `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_ESCALATED`
- `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`
- `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED`

**Events Routed (broker-ctrl — BrokerCtrlRoutedEventTypes, internal broker dispatch):**
- `SIM_ORDER_REQUESTED`, `SIM_DEPOSIT_INITIATED`, `SIM_WITHDRAWAL_REQUESTED`
- `ALPACA_ORDER_REQUESTED`, `ALPACA_ORDER_CANCEL_REQUESTED`, `ALPACA_TRANSFER_REQUESTED`, `ALPACA_ACCOUNT_CHECK`

**Events Consumed (broker-ctrl — BrokerCtrlInboundEventTypes):**
- From execution-ctrl: `ORDER_SUBMITTED`
- From investor-adpt: `EXECUTION_MODE_CHANGED`, `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`
- Adapter results (broker-sim-adpt): `SIM_ORDER_FILLED`, `SIM_ORDER_REJECTED`, `SIM_DEPOSIT_COMPLETED`, `SIM_WITHDRAWAL_COMPLETED`
- Adapter results (broker-alpaca-adpt): `ALPACA_ORDER_FILLED`, `ALPACA_ORDER_PARTIALLY_FILLED`, `ALPACA_ORDER_REJECTED`, `ALPACA_ORDER_CANCELLED`, `ALPACA_ORDER_CANCEL_FAILED`, `ALPACA_TRANSFER_COMPLETED`, `ALPACA_TRANSFER_FAILED`, `ALPACA_ACCOUNT_SNAPSHOT`

**Adapter Ingestion (execution-adpt — pull model):**
- AdvisoryBus → ExecutionBus: `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`
- InvestorBus → ExecutionBus: `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED`, `EXECUTION_MODE_CHANGED`

---

## Domain: Investor
**Responsibility:** Investor entity management, onboarding, dashboard, portal
**EventBridge Bus:** InvestorBus
**Services:** investor-ctrl, investor-bff, investor-hub, investor-adpt, dashboard-bff, onboarding-bff, investor-web

**Events Produced (cross-domain — InvestorCrossDomainEventTypes):**
- `GOAL_UPDATED` — investor goal updated (→ Advisory)
- `RISK_PROFILE_UPDATED` — risk profile updated (→ Advisory)
- `OPERATING_MODE_CHANGED` — operating mode changed, triggers mandate guardrail re-derivation in investor-bff (→ Advisory)
- `MANDATE_CREATED` — full advisory mandate granted (→ Advisory)
- `MANDATE_UPDATED` — mandate parameters updated (→ Advisory)
- `DEPOSIT_INITIATED` — deposit initiated by investor (→ Execution)
- `WITHDRAWAL_REQUESTED` — withdrawal requested by investor (→ Execution)
- `ACCOUNT_CLOSURE_REQUESTED` — account closure requested (→ Execution)
- `EXECUTION_MODE_CHANGED` — execution mode changed (→ Execution)

**Events Produced (investor-ctrl — InvestorCtrlEventTypes):**
- `NOTIFICATION_CREATED`, `NOTIFICATION_SENT`, `NOTIFICATION_DELIVERED`, `MONTHLY_REPORT_GENERATED`

**Adapter Ingestion (investor-adpt — pull model):**
- AdvisoryBus → InvestorBus: `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED`
- ExecutionBus → InvestorBus: `ORDER_STAGED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `ORDER_ESCALATED`, `BROKER_CIRCUIT_OPEN`, `TRANSFER_FAILED`
- LedgerBus → InvestorBus: `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `LEDGER_ENTRY_RECORDED`, `RECONCILIATION_COMPLETED`, `LEDGER_PROCESSING_FAILED`

---

## Domain: Ledger
**Responsibility:** Financial record-keeping, reconciliation, reporting
**EventBridge Bus:** LedgerBus
**Services:** ledger-ctrl, ledger-bff, ledger-hub, ledger-adpt, reconciliation-ctrl

**Events Produced (cross-domain — LedgerCrossDomainEventTypes):**
- `BALANCE_UPDATED` — account balance updated (→ Investor)
- `PORTFOLIO_UPDATED` — portfolio positions updated (→ Investor + Advisory)
- `LEDGER_ENTRY_RECORDED` — new ledger entry recorded (→ Investor)
- `RECONCILIATION_COMPLETED` — reconciliation completed successfully (→ Investor)
- `LEDGER_PROCESSING_FAILED` — ledger processing error (→ Investor)
- `PORTFOLIO_DRIFT_DETECTED` — drift detected by ledger/reconciliation (→ Advisory)

**Events Produced (ledger-ctrl — LedgerCtrlEventTypes):**
- `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `LEDGER_ENTRY_RECORDED`, `LEDGER_PROCESSING_FAILED`, `LEDGER_SIMULATION_FAILED`

**Adapter Ingestion (ledger-adpt — pull model):**
- ExecutionBus → LedgerBus: `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `TRANSFER_FAILED`, `CORPORATE_ACTION_APPLIED`, `PORTFOLIO_SNAPSHOT_IMPORTED`, `ALPACA_ACCOUNT_SNAPSHOT`
- AdvisoryBus → LedgerBus: `DECISION_PACKET_CREATED`

---

## Cross-Domain Event Topology (Pull Model)

Each adapter deploys EB rules on **foreign** domain buses to ingest events into its own bus.

```
investor-adpt ingests:
  From AdvisoryBus → InvestorBus:
    DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED,
    DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED,
    CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED
  From ExecutionBus → InvestorBus:
    ORDER_STAGED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED,
    DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, TRANSFER_FAILED
  From LedgerBus → InvestorBus:
    BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED,
    RECONCILIATION_COMPLETED, LEDGER_PROCESSING_FAILED

advisory-adpt ingests:
  From InvestorBus → AdvisoryBus:
    GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED,
    OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED
  From ExecutionBus → AdvisoryBus:
    ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
  From LedgerBus → AdvisoryBus:
    PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED

execution-adpt ingests:
  From AdvisoryBus → ExecutionBus:
    DECISION_APPROVED, USER_CONFIRMED,
    CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET
  From InvestorBus → ExecutionBus:
    DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

ledger-adpt ingests:
  From ExecutionBus → LedgerBus:
    ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED,
    DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED,
    PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT
  From AdvisoryBus → LedgerBus:
    DECISION_PACKET_CREATED
```

---

## Reference Files
- Adapter stacks: `services/{domain}/{domain}-adpt/src/service.stack.ts`
- Cross-domain event types: `services/{domain}/{domain}-adpt/src/domain/events.ts`
- Domain-internal event types: `services/{domain}/{domain}-ctrl/src/domain/events.ts`
- Ingress subscriptions: look for `eventTypes:` arrays in service `service.stack.ts` files

## Anti-Patterns
- NEVER route events directly between services — always through the domain bus + adapter
- NEVER add ingestion rules to a non-adapter service
- NEVER create event types without registering them in the producer's events.ts
- NEVER publish cross-domain events from a service that is not the domain's primary ctrl or a named producer — all cross-domain types live in `{domain}-adpt/src/domain/events.ts`
