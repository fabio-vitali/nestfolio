# Investor Onboarding

> New investor completes onboarding wizard, goals/risk/mandate are persisted and forwarded to advisory domain

**Domains:** investor, advisory

**Trigger:** onboarding-bff emits ONBOARDING_COMPLETED (CDC from OnboardingCompleted:INSERT)

## Flowchart

```mermaid
flowchart TD
    subgraph investor["Investor Domain"]
        onboarding_bff["onboarding-bff"]
        investor_bff["investor-bff"]
        investor_ctrl["investor-ctrl"]
    end
    subgraph advisory["Advisory Domain"]
        decision_workflow_ctrl["decision-workflow-ctrl"]
    end
    onboarding_bff -->|"ONBOARDING_COMPLETED"| investor_bff
    investor_bff -->|"MANDATE_GRANTED, MANDATE_GRANTED"| decision_workflow_ctrl
```

## Sequence Diagram

```mermaid
sequenceDiagram
    box investor domain
        participant onboarding_bff as onboarding-bff
        participant investor_bff as investor-bff
        participant investor_ctrl as investor-ctrl
    end
    box advisory domain
        participant decision_workflow_ctrl as decision-workflow-ctrl
    end
    Note over onboarding_bff: User completes 7-phase onboarding wizard via Copi…
    onboarding_bff->>+investor_bff: ONBOARDING_COMPLETED
    investor_bff-)investor_ctrl: GOAL_UPDATED (InvestorBus → AdvisoryBus)
    investor_bff-)investor_ctrl: RISK_PROFILE_UPDATED (InvestorBus → AdvisoryBus)
    investor_bff-)investor_ctrl: MANDATE_GRANTED (InvestorBus → AdvisoryBus)
    investor_bff-)investor_ctrl: OPERATING_MODE_CHANGED (InvestorBus → AdvisoryBus)
    investor_bff->>+decision_workflow_ctrl: MANDATE_GRANTED
```

## Steps

### Step 1: onboarding-bff

- **Action:** User completes 7-phase onboarding wizard via CopilotKit UI
- **State change:** Writes OnboardingCompleted record to DDB
- **Emits:** `ONBOARDING_COMPLETED (CDC)`
- **Idempotent:** yes

### Step 2: investor-bff

- **Receives:** `ONBOARDING_COMPLETED`
- **Via:** InvestorBus -> SQS -> investor-bff-ingress
- **State change:** Materializes Goal, RiskProfile, Mandate, InvestorProfile, OperatingModeRecord records
- **Emits:** `GOAL_UPDATED, RISK_PROFILE_UPDATED, MANDATE_GRANTED, OPERATING_MODE_CHANGED (CDC)`
- **Idempotent:** yes

### Step 3: Cross-domain hop

- **Event:** `GOAL_UPDATED`
- **From:** InvestorBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule

### Step 4: Cross-domain hop

- **Event:** `RISK_PROFILE_UPDATED`
- **From:** InvestorBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule

### Step 5: Cross-domain hop

- **Event:** `MANDATE_GRANTED`
- **From:** InvestorBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule

### Step 6: Cross-domain hop

- **Event:** `OPERATING_MODE_CHANGED`
- **From:** InvestorBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule

### Step 7: investor-ctrl

- **Receives:** `ONBOARDING_COMPLETED`
- **Via:** InvestorBus -> SQS -> investor-ctrl-ingress
- **State change:** Updates investor lifecycle state
- **Emits:** `NOTIFICATION_CREATED (CDC)`
- **Idempotent:** yes

### Step 8: decision-workflow-ctrl

- **Receives:** `MANDATE_GRANTED`
- **Via:** AdvisoryBus -> SQS -> decision-workflow-ctrl-TriggerIngress
- **State change:** Starts new Step Functions execution for initial advisory decision cycle
- **Emits:** `DECISION_PACKET_CREATED (CDC)`
- **Idempotent:** yes

## Success Criteria

- Investor profile, goals, risk profile, and mandate are persisted in investor-bff DDB table
- Advisory domain receives MANDATE_GRANTED and triggers first decision cycle
- Execution domain receives OPERATING_MODE_CHANGED (forwarded via investor-adpt ToExecution)

## Failure Modes

- **step 1 fails:** Onboarding session incomplete; user can retry wizard. DLQ on onboarding-bff ingress
- **step 2 fails:** investor-bff ingress DLQ captures event; CDC events not emitted until replay
- **step 3-6 fails:** investor-adpt forwarding DLQ (ToAdvisoryDLQ); advisory domain does not receive events
- **step 8 fails:** decision-workflow-ctrl ingress DLQ; initial advisory cycle not started
