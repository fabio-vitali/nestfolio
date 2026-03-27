# decision-workflow-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/decision-workflow-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> decision-workflow-ctrl-trigger-ingress (SQS -> Lambda)
  Subscriptions: MANDATE_GRANTED, GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED

- AdvisoryBus -> decision-workflow-ctrl-callback-ingress (SQS -> Lambda: sfn-callback.ts)
  Subscriptions: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED

## Egress
- CDC: DynamoDB Streams -> decision-workflow-ctrl-egress (Lambda)
  Emits: WorkflowTrigger, DecisionPacket, AgentOutput

## Step Functions
- DecisionStateMachine: Decision lifecycle orchestrator
  1. Parallel: InvestorProfile + MarketIntelligence (waitForTaskToken)
  2. Sequential: PortfolioEngine (waitForTaskToken)
  3. Sequential: AdvisoryNarrative (waitForTaskToken)
  4. AssemblePacket (Lambda Task - reads outputs from Memory)
  5. WaitForCompliance (waitForTaskToken)
  6. Choice: APPROVED L1 -> end, BLOCKED -> end, L2 -> user confirmation
  7. WaitForUserResponse (waitForTaskToken)
  8. End

## AgentCore Memory
- Shared agent memory: nestfolio_{prefix}_agent_memory (90-day TTL)
  Strategies:
  - InvestorPreferenceLearner (UserPreference, /investor-profile/{actorId}/preferences)
  - MarketSignalExtractor (Semantic, /market-intelligence/{actorId}/signals)
  - AllocationRationaleExtractor (Semantic, /portfolio-engine/{actorId}/rationale)
  - NarrativePreferenceLearner (UserPreference, /advisory-narrative/{actorId}/preferences)
  - NarrativeSessionSummarizer (Summarization, /advisory-narrative/{actorId}/sessions)
- Memory ID exported via SSM: memory/id

## Handlers
- event-listener.ts
- sfn-callback.ts
- assemble-packet.ts

## Tests
- decision-state-machine.test.ts
- event-listener.test.ts
- sfn-callback.test.ts
- assemble-packet.test.ts

## Dependencies
- libs: cdk-constructs (core, utils), @aws-cdk/aws-bedrock-agentcore-alpha, @aws-cdk/aws-bedrock-alpha
- SSM: advisory-hub (models/sonnet)
