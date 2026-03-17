# Option B: 4-Service Split

```mermaid
flowchart TB
    subgraph INGRESS["Ingress Events (EventBridge)"]
        direction TB
        IE1["MANDATE_GRANTED<br/><i>investor-adpt</i>"]
        IE2["GOAL_UPDATED<br/><i>investor-adpt</i>"]
        IE3["RISK_PROFILE_UPDATED<br/><i>investor-adpt</i>"]
        IE4["OPERATING_MODE_CHANGED<br/><i>investor-adpt</i>"]
        IE5["PORTFOLIO_DRIFT_DETECTED<br/><i>ledger-adpt</i>"]
        IE6["ORDER_FILLED<br/><i>execution-adpt</i>"]
        IE7["ORDER_REJECTED<br/><i>execution-adpt</i>"]
        IE8["ORDER_CANCELLED<br/><i>execution-adpt</i>"]
        IE9["DEPOSIT_DETECTED<br/><i>execution-adpt</i>"]
    end

    subgraph CALLBACK["Callback Events (EventBridge)"]
        direction TB
        CB1["DECISION_APPROVED<br/><i>compliance-ctrl</i>"]
        CB2["DECISION_BLOCKED<br/><i>compliance-ctrl</i>"]
        CB3["USER_CONFIRMED<br/><i>advisory-bff</i>"]
        CB4["USER_REJECTED<br/><i>advisory-bff</i>"]
    end

    %% ===== SERVICE 1: INVESTOR ANALYSIS =====
    subgraph SVC1["investor-analysis-ctrl"]
        direction TB

        subgraph SVC1_LISTENER["event-listener"]
            SVC1_ROUTE{"Route"}
            SVC1_TRIGGER["handleTriggerEvent()"]
            SVC1_COMPLY["processComplianceCallback()"]
            SVC1_USER["processUserResponse()"]
            SVC1_ROUTE -->|"9 triggers"| SVC1_TRIGGER
            SVC1_ROUTE -->|"APPROVED/BLOCKED"| SVC1_COMPLY
            SVC1_ROUTE -->|"CONFIRMED/REJECTED"| SVC1_USER
        end

        subgraph SVC1_IDEMP["Decision Packet Owner"]
            SVC1_CREATE["createDecisionPacket()<br/><i>putIfNotExists — idempotent</i>"]
        end

        subgraph SVC1_GRAPH["LangGraph — Parallel Wave"]
            direction LR
            subgraph SVC1_UG["user-goals"]
                SVC1_UG_P["Prompt: goal interpretation"]
                SVC1_UG_RAG["RAG Retrieve<br/><i>investor mandates,<br/>onboarding history,<br/>goal change history</i>"]
                SVC1_UG_M["<b>Haiku</b> · 2048 tok · t=0.0"]
                SVC1_UG_V["Zod + Validate:<br/>horizon 1-600mo"]
                SVC1_UG_P --> SVC1_UG_RAG --> SVC1_UG_M --> SVC1_UG_V
            end
            subgraph SVC1_RA["risk-assessment"]
                SVC1_RA_P["Prompt: risk profiling"]
                SVC1_RA_RAG["RAG Retrieve<br/><i>regulatory docs,<br/>risk frameworks,<br/>mandate constraints</i>"]
                SVC1_RA_M["<b>Opus</b> · 4096 tok · t=0.1"]
                SVC1_RA_V["Zod + Validate:<br/>score-category consistency"]
                SVC1_RA_P --> SVC1_RA_RAG --> SVC1_RA_M --> SVC1_RA_V
            end
        end

        subgraph SVC1_RETRY["Retry & Escalation"]
            SVC1_TRY["Invoke"] --> SVC1_CHK{"Valid?"}
            SVC1_CHK -->|"yes"| SVC1_OK["OK"]
            SVC1_CHK -->|"no"| SVC1_ESC["Escalate"] --> SVC1_TRY
            SVC1_CHK -->|"max"| SVC1_FB["Fallback"]
        end

        subgraph SVC1_KB["Bedrock Knowledge Base"]
            direction LR
            SVC1_S3["S3: investor mandates,<br/>regulatory docs,<br/>risk frameworks"]
            SVC1_VS["OpenSearch Serverless"]
            SVC1_SYNC["Sync Job"]
            SVC1_S3 --> SVC1_SYNC --> SVC1_VS
        end

        subgraph SVC1_INGEST["RAG Ingestion"]
            SVC1_ING1["MANDATE_GRANTED → S3"]
            SVC1_ING2["RISK_PROFILE_UPDATED → S3"]
            SVC1_ING3["GOAL_UPDATED → S3"]
            SVC1_ING4["Static: regulatory docs"]
        end

        subgraph SVC1_STATE["DynamoDB"]
            SVC1_DP["DecisionPacket<br/><i>owner</i>"]
            SVC1_AI["AgentInvocation"]
            SVC1_EDIT["EditEvent"]
        end

        SVC1_TRIGGER --> SVC1_CREATE --> SVC1_GRAPH
        SVC1_GRAPH -.->|"retrieve"| SVC1_KB
        SVC1_GRAPH -.->|"retry"| SVC1_RETRY
        SVC1_GRAPH --> SVC1_STATE
        SVC1_COMPLY --> SVC1_STATE
        SVC1_USER --> SVC1_STATE
        SVC1_INGEST -.->|"ingest"| SVC1_KB
    end

    subgraph SVC1_EGRESS["investor-analysis-ctrl Egress"]
        direction LR
        SVC1_OE1["DECISION_PACKET_CREATED"]
        SVC1_OE2["GOAL_INTERPRETATION_PRODUCED"]
        SVC1_OE3["INVESTOR_ANALYSIS_COMPLETED<br/><i>payload: goals + risk</i>"]
    end

    %% ===== SERVICE 2: MARKET INTELLIGENCE =====
    subgraph SVC2["market-intelligence-ctrl"]
        direction TB

        subgraph SVC2_LISTENER["event-listener"]
            SVC2_ROUTE{"Route"}
            SVC2_ROUTE -->|"INVESTOR_ANALYSIS_COMPLETED"| SVC2_TRIGGER["handleAnalysisCompleted()"]
        end

        subgraph SVC2_AGENT["Single Agent — market-research"]
            SVC2_MR_P["Prompt: market signals<br/><i>receives investor goals +<br/>risk profile as context</i>"]
            SVC2_MR_RAG["RAG Retrieve<br/><i>market reports,<br/>sector analysis,<br/>economic indicators,<br/>earnings data</i>"]
            SVC2_MR_M["<b>Sonnet</b> · 4096 tok · t=0.2"]
            SVC2_MR_V["Zod + Validate:<br/>no duplicate tickers"]
            SVC2_MR_P --> SVC2_MR_RAG --> SVC2_MR_M --> SVC2_MR_V
        end

        subgraph SVC2_RETRY["Retry & Escalation"]
            SVC2_TRY["Invoke"] --> SVC2_CHK{"Valid?"}
            SVC2_CHK -->|"yes"| SVC2_OK["OK"]
            SVC2_CHK -->|"no"| SVC2_ESC["Escalate"] --> SVC2_TRY
            SVC2_CHK -->|"max"| SVC2_FB["Fallback"]
        end

        subgraph SVC2_KB["Bedrock Knowledge Base"]
            direction LR
            SVC2_S3["S3: market reports,<br/>sector analysis,<br/>economic indicators"]
            SVC2_VS["OpenSearch Serverless"]
            SVC2_SYNC["Sync Job<br/><i>scheduled: hourly/daily</i>"]
            SVC2_S3 --> SVC2_SYNC --> SVC2_VS
        end

        subgraph SVC2_INGEST["RAG Ingestion"]
            SVC2_ING1["Scheduled: market data<br/>feed snapshots (hourly)"]
            SVC2_ING2["Scheduled: sector/earnings<br/>reports (daily)"]
            SVC2_ING3["Static: instrument universe,<br/>index compositions"]
        end

        subgraph SVC2_TOOLS["Tool Lambdas"]
            direction LR
            SVC2_T1["market-data<br/><i>live indices/vol</i>"]
            SVC2_T2["instrument-universe<br/><i>approved instruments</i>"]
        end

        subgraph SVC2_STATE["DynamoDB"]
            SVC2_AI["AgentInvocation"]
            SVC2_RO["ReasoningOutput"]
        end

        SVC2_TRIGGER --> SVC2_AGENT
        SVC2_AGENT -.->|"retrieve"| SVC2_KB
        SVC2_AGENT -.->|"tool calls"| SVC2_TOOLS
        SVC2_AGENT -.->|"retry"| SVC2_RETRY
        SVC2_AGENT --> SVC2_STATE
        SVC2_INGEST -.->|"ingest"| SVC2_KB
    end

    subgraph SVC2_EGRESS["market-intelligence-ctrl Egress"]
        direction LR
        SVC2_OE1["MARKET_SIGNAL_DETECTED"]
        SVC2_OE2["MARKET_ANALYSIS_COMPLETED<br/><i>payload: signals + tickers +<br/>outlook + upstream context</i>"]
    end

    %% ===== SERVICE 3: PORTFOLIO ENGINE =====
    subgraph SVC3["portfolio-engine-ctrl"]
        direction TB

        subgraph SVC3_LISTENER["event-listener"]
            SVC3_ROUTE{"Route"}
            SVC3_ROUTE -->|"MARKET_ANALYSIS_COMPLETED"| SVC3_TRIGGER["handleMarketCompleted()"]
        end

        subgraph SVC3_GRAPH["LangGraph — Parallel Wave"]
            direction LR
            subgraph SVC3_PC["portfolio-construction"]
                SVC3_PC_P["Prompt: allocation design<br/><i>receives full upstream:<br/>goals + risk + market</i>"]
                SVC3_PC_RAG["RAG Retrieve<br/><i>allocation models,<br/>historical portfolios,<br/>benchmark compositions</i>"]
                SVC3_PC_M["<b>Opus</b> · 4096 tok · t=0.1"]
                SVC3_PC_V["Zod + Validate:<br/>weights ≈1.0, limits"]
                SVC3_PC_P --> SVC3_PC_RAG --> SVC3_PC_M --> SVC3_PC_V
            end
            subgraph SVC3_RP["rebalance-planner"]
                SVC3_RP_P["Prompt: trade planning<br/><i>receives full upstream +<br/>current portfolio state</i>"]
                SVC3_RP_RAG["RAG Retrieve<br/><i>trade history,<br/>cost benchmarks,<br/>tax-loss patterns</i>"]
                SVC3_RP_M["<b>Sonnet</b> · 4096 tok · t=0.1"]
                SVC3_RP_V["Zod + Validate:<br/>urgency, cost bps"]
                SVC3_RP_P --> SVC3_RP_RAG --> SVC3_RP_M --> SVC3_RP_V
            end
        end

        subgraph SVC3_RETRY["Retry & Escalation"]
            SVC3_TRY["Invoke"] --> SVC3_CHK{"Valid?"}
            SVC3_CHK -->|"yes"| SVC3_OK["OK"]
            SVC3_CHK -->|"no"| SVC3_ESC["Escalate"] --> SVC3_TRY
            SVC3_CHK -->|"max"| SVC3_FB["Fallback"]
        end

        subgraph SVC3_KB["Bedrock Knowledge Base"]
            direction LR
            SVC3_S3["S3: allocation models,<br/>portfolio history,<br/>trade benchmarks,<br/>tax-loss patterns"]
            SVC3_VS["OpenSearch Serverless"]
            SVC3_SYNC["Sync Job"]
            SVC3_S3 --> SVC3_SYNC --> SVC3_VS
        end

        subgraph SVC3_INGEST["RAG Ingestion"]
            SVC3_ING1["ORDER_FILLED →<br/>store trade record in S3"]
            SVC3_ING2["PORTFOLIO_DRIFT_DETECTED →<br/>store drift snapshot"]
            SVC3_ING3["PORTFOLIO_CONSTRUCTION_PROPOSED →<br/>store past allocations"]
            SVC3_ING4["Static: allocation model<br/>docs, benchmark data"]
        end

        subgraph SVC3_TOOLS["Tool Lambdas"]
            direction LR
            SVC3_T1["portfolio-lookup<br/><i>DDB: PortfolioSnapshot</i>"]
        end

        subgraph SVC3_STATE["DynamoDB"]
            SVC3_AI["AgentInvocation"]
            SVC3_RO["ReasoningOutput"]
            SVC3_TRADES["ProposedTrades"]
        end

        SVC3_TRIGGER --> SVC3_GRAPH
        SVC3_GRAPH -.->|"retrieve"| SVC3_KB
        SVC3_GRAPH -.->|"tool calls"| SVC3_TOOLS
        SVC3_GRAPH -.->|"retry"| SVC3_RETRY
        SVC3_GRAPH --> SVC3_STATE
        SVC3_INGEST -.->|"ingest"| SVC3_KB
    end

    subgraph SVC3_EGRESS["portfolio-engine-ctrl Egress"]
        direction LR
        SVC3_OE1["PORTFOLIO_CONSTRUCTION_PROPOSED"]
        SVC3_OE2["REBALANCE_PLAN_PRODUCED"]
        SVC3_OE3["PORTFOLIO_COMPLETED<br/><i>payload: trades + allocations +<br/>full upstream context</i>"]
    end

    %% ===== SERVICE 4: ADVISORY INSIGHT =====
    subgraph SVC4["advisory-insight-ctrl"]
        direction TB

        subgraph SVC4_LISTENER["event-listener"]
            SVC4_ROUTE{"Route"}
            SVC4_ROUTE -->|"PORTFOLIO_COMPLETED"| SVC4_TRIGGER["handlePortfolioCompleted()"]
        end

        subgraph SVC4_AGENT["Single Agent — explainability"]
            SVC4_EX_P["Prompt: user explanation<br/><i>receives full pipeline context:<br/>goals + risk + market +<br/>portfolio + trades</i>"]
            SVC4_EX_RAG["RAG Retrieve<br/><i>communication templates,<br/>past rationales,<br/>investor preferences,<br/>tone/style history</i>"]
            SVC4_EX_M["<b>Sonnet</b> · 8192 tok · t=0.3"]
            SVC4_EX_V["Zod + Validate:<br/>summary > 20 chars,<br/>≥1 key factor"]
            SVC4_EX_P --> SVC4_EX_RAG --> SVC4_EX_M --> SVC4_EX_V
        end

        subgraph SVC4_RETRY["Retry & Escalation"]
            SVC4_TRY["Invoke"] --> SVC4_CHK{"Valid?"}
            SVC4_CHK -->|"yes"| SVC4_OK["OK"]
            SVC4_CHK -->|"no"| SVC4_ESC["Escalate"] --> SVC4_TRY
            SVC4_CHK -->|"max"| SVC4_FB["Fallback"]
        end

        subgraph SVC4_KB["Bedrock Knowledge Base"]
            direction LR
            SVC4_S3["S3: communication<br/>templates, past rationales,<br/>style guides"]
            SVC4_VS["OpenSearch Serverless"]
            SVC4_SYNC["Sync Job"]
            SVC4_S3 --> SVC4_SYNC --> SVC4_VS
        end

        subgraph SVC4_INGEST["RAG Ingestion"]
            SVC4_ING1["EXPLANATION_GENERATED →<br/>store past rationale in S3"]
            SVC4_ING2["USER_CONFIRMED/REJECTED →<br/>store feedback for tone tuning"]
            SVC4_ING3["Static: communication<br/>style guides, templates"]
        end

        subgraph SVC4_STATE["DynamoDB"]
            SVC4_AI["AgentInvocation"]
            SVC4_RO["ReasoningOutput"]
        end

        SVC4_TRIGGER --> SVC4_AGENT
        SVC4_AGENT -.->|"retrieve"| SVC4_KB
        SVC4_AGENT -.->|"retry"| SVC4_RETRY
        SVC4_AGENT --> SVC4_STATE
        SVC4_INGEST -.->|"ingest"| SVC4_KB
    end

    subgraph SVC4_EGRESS["advisory-insight-ctrl Egress"]
        direction LR
        SVC4_OE1["EXPLANATION_GENERATED"]
        SVC4_OE2["RECOMMENDATION_PROPOSED"]
        SVC4_OE3["USER_CONFIRMATION_REQUESTED"]
    end

    %% ===== FLOW CONNECTIONS =====
    INGRESS --> SVC1_LISTENER
    CALLBACK --> SVC1_LISTENER

    SVC1_STATE -->|"CDC"| SVC1_EGRESS
    SVC1_EGRESS -->|"INVESTOR_ANALYSIS_COMPLETED"| SVC2_LISTENER

    SVC2_STATE -->|"CDC"| SVC2_EGRESS
    SVC2_EGRESS -->|"MARKET_ANALYSIS_COMPLETED"| SVC3_LISTENER

    SVC3_STATE -->|"CDC"| SVC3_EGRESS
    SVC3_EGRESS -->|"PORTFOLIO_COMPLETED"| SVC4_LISTENER

    SVC4_STATE -->|"CDC"| SVC4_EGRESS

    %% RAG ingestion from cross-service events
    INGRESS -.->|"MANDATE_GRANTED,<br/>GOAL_UPDATED,<br/>RISK_PROFILE_UPDATED"| SVC1_INGEST
    INGRESS -.->|"ORDER_FILLED,<br/>PORTFOLIO_DRIFT"| SVC3_INGEST
    SVC3_EGRESS -.->|"PORTFOLIO_CONSTRUCTION_PROPOSED"| SVC3_INGEST
    SVC4_EGRESS -.->|"EXPLANATION_GENERATED"| SVC4_INGEST
    CALLBACK -.->|"USER_CONFIRMED/REJECTED"| SVC4_INGEST

    %% Styling
    classDef svc1 fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    classDef svc2 fill:#fff8e1,stroke:#f9a825,color:#e65100
    classDef svc3 fill:#fff3e0,stroke:#e65100,color:#bf360c
    classDef svc4 fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
    classDef event fill:#f3e5f5,stroke:#6a1b9a,color:#4a148c
    classDef kb fill:#fce4ec,stroke:#c62828,color:#b71c1c

    class SVC1,SVC1_GRAPH,SVC1_STATE svc1
    class SVC2,SVC2_AGENT,SVC2_STATE svc2
    class SVC3,SVC3_GRAPH,SVC3_STATE svc3
    class SVC4,SVC4_AGENT,SVC4_STATE svc4
    class SVC1_EGRESS,SVC2_EGRESS,SVC3_EGRESS,SVC4_EGRESS event
    class SVC1_KB,SVC2_KB,SVC3_KB,SVC4_KB kb
```

## Architecture Summary

| | investor-analysis-ctrl | market-intelligence-ctrl | portfolio-engine-ctrl | advisory-insight-ctrl |
|---|---|---|---|---|
| **Agents** | user-goals + risk-assessment | market-research | portfolio-construction + rebalance-planner | explainability |
| **Orchestration** | Parallel wave | Single agent | Parallel wave | Single agent |
| **Knowledge Base** | Investor mandates, regulatory docs, risk frameworks | Market reports, sector analysis, economic indicators | Allocation models, portfolio history, trade benchmarks | Communication templates, past rationales |
| **RAG Ingestion** | MANDATE_GRANTED, GOAL_UPDATED, RISK_PROFILE_UPDATED + static regulatory | Scheduled: market feeds (hourly), earnings (daily) + static instruments | ORDER_FILLED, PORTFOLIO_DRIFT, past allocations + static benchmarks | EXPLANATION_GENERATED, USER feedback + static templates |
| **Tool Lambdas** | None | market-data, instrument-universe | portfolio-lookup | None |
| **Trigger event** | 9 ingress events | INVESTOR_ANALYSIS_COMPLETED | MARKET_ANALYSIS_COMPLETED | PORTFOLIO_COMPLETED |
| **Output event** | INVESTOR_ANALYSIS_COMPLETED | MARKET_ANALYSIS_COMPLETED | PORTFOLIO_COMPLETED | RECOMMENDATION_PROPOSED |
| **Owns** | DecisionPacket + callbacks | Market signals | Trades + allocations | Explanation + confirmation |
| **Infra** | DDB + KB + 1 Lambda | DDB + KB + 3 Lambdas | DDB + KB + 2 Lambdas | DDB + KB + 1 Lambda |

## Event Chain (4 hops)

```
9 triggers → investor-analysis-ctrl
                    │
                    └── INVESTOR_ANALYSIS_COMPLETED ──→ market-intelligence-ctrl
                                                              │
                                                              └── MARKET_ANALYSIS_COMPLETED ──→ portfolio-engine-ctrl
                                                                                                      │
                                                                                                      └── PORTFOLIO_COMPLETED ──→ advisory-insight-ctrl
                                                                                                                                        │
                                                                                                                                        └── RECOMMENDATION_PROPOSED
```

## Cost Comparison vs Option A

| Component | Option A (3 svc) | Option B (4 svc) | Delta |
|-----------|------------------|------------------|-------|
| Knowledge Bases | 3 | 4 | +1 |
| OpenSearch Serverless (min) | ~$2100/mo | ~$2800/mo | +$700/mo |
| DDB tables | 3 | 4 | +1 |
| Lambda functions | ~10-12 | ~14-16 | +4 |
| Event hops (latency) | 2 | 3 | +100-200ms |
| Deployment pipelines | 3 | 4 | +1 |
| **RAG precision** | **Good** | **Best** | Market KB fully isolated |
| **Independent scaling** | **Good** | **Best** | Market intel scales alone |
