# Advisory Agent Topology: Multi-Service Split with RAG & Step Functions Orchestration

## Motivation

The current `advisory-ctrl` is a monolithic service that:
1. Handles 13 inbound event types (9 triggers + 2 compliance + 2 user responses)
2. Runs a 6-agent LangGraph pipeline in-process (3 waves, sequential)
3. Manages decision packet lifecycle (creation → agent execution → approval → confirmation)
4. Owns 4 tool Lambdas for agent data access
5. Publishes 12+ event types via CDC

This conflates five distinct concerns: **orchestration**, **investor analysis**, **market intelligence**, **portfolio engineering**, and **user-facing narrative**. Each concern has different:
- Knowledge domains (regulatory vs market vs fund vs communication)
- Scaling profiles (Haiku vs Opus, real-time vs batch)
- Data freshness requirements (static regulatory docs vs hourly market feeds)
- RAG retrieval needs (semantic search over regulations vs news vs prospectuses)

### Why split by Knowledge Base boundaries

The split is **KB-driven, not agent-count-driven**. Each service clusters agents that share the same knowledge domain:

| Service | Agents | Shared Knowledge Domain |
|---|---|---|
| investor-profile-ctrl | user-goals + risk-assessment | Investor mandates + regulatory constraints |
| market-intelligence-ctrl | market-research | Market news + macro indicators + sector analysis |
| portfolio-engine-ctrl | portfolio-construction + rebalance-planner | Fund prospectuses + instrument data + allocation history |
| advisory-narrative-ctrl | explainability | Communication templates + past rationale feedback |

A centralized **decision-workflow-ctrl** orchestrates the pipeline via Step Functions, owns the DecisionPacket lifecycle, and handles compliance/user callbacks.

### Why Step Functions orchestration

The current in-process LangGraph wave execution becomes cross-service coordination. Step Functions provides:
- **Durable execution** — retries, timeouts, error handling without custom code
- **Visual workflow** — the state machine IS the documentation
- **Task token pattern** — publish event, pause, resume on completion event (`.waitForTaskToken`)
- **Decision packet state** — the orchestrator owns the full lifecycle in one DDB table

---

## Service Topology

### 1. decision-workflow-ctrl

**Role:** Orchestrates the decision lifecycle via AWS Step Functions. Owns the DecisionPacket aggregate. Handles compliance callbacks and user responses.

**Task token pattern:** Each `waitForTaskToken` step uses the Step Functions → EventBridge PutEvents integration, which automatically injects the `taskToken` into the event payload. The agent service receives the token in the trigger event, propagates it through processing, and includes it in the completion event. The orchestrator's event-listener Lambda extracts the token from the completion event payload and calls `SendTaskSuccess(taskToken, outputs)` to resume the state machine. No DDB storage of tokens is needed.

```
SF task state (waitForTaskToken)
  → PutEvents(ANALYZE_MARKET, { decisionId, context, taskToken })
  → State machine PAUSES

Agent service event-listener receives { decisionId, context, taskToken }
  → Runs agent pipeline (LangGraph + RAG)
  → PutEvents(MARKET_ANALYSIS_COMPLETED, { decisionId, outputs, taskToken })

Orchestrator event-listener receives { decisionId, outputs, taskToken }
  → SendTaskSuccess(taskToken, outputs)
  → State machine RESUMES with outputs
```

**Step Functions State Machine:**

```
START (9 trigger events)
  │
  ├── CreateDecisionPacket (idempotent conditional write)
  │
  ├── Parallel: InvestorProfile + MarketIntelligence
  │     ├── InvokeInvestorProfile (publish event + waitForTaskToken)
  │     │     └── receives: INVESTOR_PROFILE_COMPLETED
  │     └── InvokeMarketIntelligence (publish event + waitForTaskToken)
  │           └── receives: MARKET_ANALYSIS_COMPLETED
  │
  ├── InvokePortfolioEngine (publish event + waitForTaskToken)
  │     └── receives: PORTFOLIO_COMPLETED
  │
  ├── InvokeAdvisoryNarrative (publish event + waitForTaskToken)
  │     └── receives: NARRATIVE_COMPLETED
  │
  ├── AssembleDecisionPacket (merge all outputs)
  │
  ├── PublishRecommendation (RECOMMENDATION_PROPOSED)
  │
  ├── WaitForCompliance (waitForTaskToken)
  │     └── receives: DECISION_APPROVED or DECISION_BLOCKED
  │     └── if BLOCKED → UpdateStatus(BLOCKED) → END
  │     └── if APPROVED L1 → UpdateStatus(APPROVED) → END
  │     └── if APPROVED L2 → continue to user confirmation
  │
  ├── RequestUserConfirmation (USER_CONFIRMATION_REQUESTED)
  │
  ├── WaitForUserResponse (waitForTaskToken)
  │     └── receives: USER_CONFIRMED or USER_REJECTED
  │
  └── UpdateFinalStatus → END
```

**Input events:**
| Event | Source | Action |
|---|---|---|
| MANDATE_GRANTED | investor-adpt | Start state machine |
| GOAL_UPDATED | investor-adpt | Start state machine |
| RISK_PROFILE_UPDATED | investor-adpt | Start state machine |
| OPERATING_MODE_CHANGED | investor-adpt | Start state machine |
| PORTFOLIO_DRIFT_DETECTED | ledger-adpt | Start state machine |
| ORDER_FILLED | execution-adpt | Start state machine |
| ORDER_REJECTED | execution-adpt | Start state machine |
| ORDER_CANCELLED | execution-adpt | Start state machine |
| DEPOSIT_DETECTED | execution-adpt | Start state machine |
| DECISION_APPROVED | compliance-ctrl | Resume WaitForCompliance |
| DECISION_BLOCKED | compliance-ctrl | Resume WaitForCompliance |
| USER_CONFIRMED | advisory-bff | Resume WaitForUserResponse |
| USER_REJECTED | advisory-bff | Resume WaitForUserResponse |
| INVESTOR_PROFILE_COMPLETED | investor-profile-ctrl | Resume InvokeInvestorProfile |
| MARKET_ANALYSIS_COMPLETED | market-intelligence-ctrl | Resume InvokeMarketIntelligence |
| PORTFOLIO_COMPLETED | portfolio-engine-ctrl | Resume InvokePortfolioEngine |
| NARRATIVE_COMPLETED | advisory-narrative-ctrl | Resume InvokeAdvisoryNarrative |

**Output events:**
| Event | Description |
|---|---|
| DECISION_PACKET_CREATED | New decision lifecycle started |
| ANALYZE_INVESTOR_PROFILE | Triggers investor-profile-ctrl (carries taskToken + decisionId + context) |
| ANALYZE_MARKET | Triggers market-intelligence-ctrl (carries task token + upstream outputs) |
| CONSTRUCT_PORTFOLIO | Triggers portfolio-engine-ctrl (carries task token + upstream outputs) |
| GENERATE_NARRATIVE | Triggers advisory-narrative-ctrl (carries task token + all outputs) |
| RECOMMENDATION_PROPOSED | Decision packet fully assembled |
| USER_CONFIRMATION_REQUESTED | L2 approval needed |
| DECISION_PACKET_ENRICHED | CDC: packet state changed |
| DECISION_FEEDBACK | Published after USER_CONFIRMED or USER_REJECTED, carries decisionId + outcome + reason. Consumed by advisory-narrative-ctrl for KB feedback loop |

**Operational events (carried over from current advisory-ctrl):**

The current advisory-ctrl publishes 35 event types including operational events (INCIDENT_DETECTED, CIRCUIT_BREAKER_TRIGGERED, MODEL_REGISTERED, SHADOW_RUN_*, TENANT_BUDGET_*, etc.). These are **deferred to a future operational concern** — they are not part of the core decision lifecycle and will be addressed when building the operational monitoring layer. The decision-workflow-ctrl can emit Step Functions execution metrics (start/complete/fail/timeout) which cover the most critical operational signals.

**Infrastructure:**
- DynamoDB table: DecisionPacket, EditEvent (status audit trail)
- Step Functions state machine
- EventBridge rules (17 inbound event types)
- Lambda: event-listener (routes events → starts execution or sends task tokens)
- No Knowledge Base

---

### 2. investor-profile-ctrl

**Role:** Analyzes investor goals and risk profile. Runs 2 agents in parallel (user-goals + risk-assessment).

**Agents:**

| Agent | Model | Tokens | Temp | Purpose |
|---|---|---|---|---|
| user-goals | Haiku | 2048 | 0.0 | Interpret investor goals, time horizon, risk willingness |
| risk-assessment | Opus | 4096 | 0.1 | Score risk, validate against regulatory constraints |

**Knowledge Base:** Regulatory & Compliance KB (see KB section below)

**Input events:**
| Event | Source | Action |
|---|---|---|
| ANALYZE_INVESTOR_PROFILE | decision-workflow-ctrl | Run agent pipeline, return results with task token |

**Output events:**
| Event | Description |
|---|---|
| INVESTOR_PROFILE_COMPLETED | Agent outputs (goals + risk assessment) + taskToken for orchestrator SendTaskSuccess |
| GOAL_INTERPRETATION_PRODUCED | CDC: goal agent output recorded |
| RISK_EVALUATION_PRODUCED | CDC: risk agent output recorded |

**Infrastructure:**
- DynamoDB table: AgentInvocation, ReasoningOutput
- Bedrock Knowledge Base (Regulatory & Compliance)
- S3 bucket: `{account}-{env}-nestfolio-kb-regulatory`
- Lambda: event-listener
- No tool Lambdas (RAG replaces structured lookups for this service)

---

### 3. market-intelligence-ctrl

**Role:** Analyzes market conditions, news sentiment, and macro indicators. Runs 1 agent (market-research).

**Agents:**

| Agent | Model | Tokens | Temp | Purpose |
|---|---|---|---|---|
| market-research | Sonnet | 4096 | 0.2 | Detect market signals, assess sentiment, identify opportunities/risks |

**Knowledge Base:** Market Intelligence KB (see KB section below)

**Input events:**
| Event | Source | Action |
|---|---|---|
| ANALYZE_MARKET | decision-workflow-ctrl | Run agent, return results with task token |
| YAHOO_FINANCE_UPDATED | yahoo-finance-adpt | Ingest news into KB |
| MARKETWATCH_UPDATED | marketwatch-adpt | Ingest headlines into KB |
| SEC_8K_FILED | sec-edgar-adpt | Ingest material event filing into KB |
| FRED_INDICATORS_UPDATED | fred-adpt | Ingest macro data into KB |
| ALPHA_VANTAGE_NEWS_UPDATED | alpha-vantage-adpt | Ingest sentiment data into KB |

**Output events:**
| Event | Description |
|---|---|
| MARKET_ANALYSIS_COMPLETED | Agent output (signals, tickers, outlook) + decisionId |
| MARKET_SIGNAL_DETECTED | CDC: market analysis recorded |

**Infrastructure:**
- DynamoDB table: AgentInvocation, ReasoningOutput
- Bedrock Knowledge Base (Market Intelligence)
- S3 bucket: `{account}-{env}-nestfolio-kb-market`
- Lambda: event-listener, kb-ingestion-handler
- Tool Lambdas: market-data (live indices/volatility), instrument-universe (approved instruments)

---

### 4. portfolio-engine-ctrl

**Role:** Constructs portfolio allocations and plans rebalancing trades. Runs 2 agents in parallel (portfolio-construction + rebalance-planner). Internal LangGraph orchestration for the parallel wave.

**Agents:**

| Agent | Model | Tokens | Temp | Purpose |
|---|---|---|---|---|
| portfolio-construction | Opus | 4096 | 0.1 | Design target allocation based on all upstream context |
| rebalance-planner | Sonnet | 4096 | 0.1 | Plan specific trades to reach target allocation |

**Knowledge Base:** Fund & Instrument KB (see KB section below)

**Input events:**
| Event | Source | Action |
|---|---|---|
| CONSTRUCT_PORTFOLIO | decision-workflow-ctrl | Run agent pipeline, return results with task token |
| SEC_PROSPECTUS_UPDATED | sec-edgar-adpt | Ingest ETF prospectus into KB |
| SEC_10K_UPDATED | sec-edgar-adpt | Ingest risk factors into KB |

**Output events:**
| Event | Description |
|---|---|
| PORTFOLIO_COMPLETED | Agent outputs (allocations + trades) + decisionId |
| PORTFOLIO_CONSTRUCTION_PROPOSED | CDC: allocation recorded |
| REBALANCE_PLAN_PRODUCED | CDC: trade plan recorded |

**Infrastructure:**
- DynamoDB table: AgentInvocation, ReasoningOutput, ProposedTrades
- Bedrock Knowledge Base (Fund & Instrument)
- S3 bucket: `{account}-{env}-nestfolio-kb-fund`
- Lambda: event-listener, kb-ingestion-handler
- Tool Lambda: portfolio-lookup (DDB query for current PortfolioSnapshot)

---

### 5. advisory-narrative-ctrl

**Role:** Generates user-facing explanations of the decision. Runs 1 agent (explainability). Its KB improves over time via a feedback loop.

**Agents:**

| Agent | Model | Tokens | Temp | Purpose |
|---|---|---|---|---|
| explainability | Sonnet | 8192 | 0.3 | Synthesize all upstream outputs into clear, personalized explanation |

**Knowledge Base:** Explainability Feedback KB (see KB section below)

**Input events:**
| Event | Source | Action |
|---|---|---|
| GENERATE_NARRATIVE | decision-workflow-ctrl | Run agent, return results with task token |
| DECISION_FEEDBACK | decision-workflow-ctrl | User confirmed/rejected — trigger feedback-correlator for KB ingestion |

**Output events:**
| Event | Description |
|---|---|
| NARRATIVE_COMPLETED | Agent output (summary, rationale, key factors) + decisionId |
| EXPLANATION_GENERATED | CDC: explanation recorded |

**Infrastructure:**
- DynamoDB table: AgentInvocation, ReasoningOutput
- Bedrock Knowledge Base (Explainability Feedback)
- S3 bucket: `{account}-{env}-nestfolio-kb-explainability`
- Lambda: event-listener, kb-ingestion-handler, feedback-correlator
- No tool Lambdas (all context arrives in the event payload from orchestrator)

**Feedback loop:** When decision-workflow-ctrl receives USER_CONFIRMED or USER_REJECTED, it publishes a DECISION_FEEDBACK event. advisory-narrative-ctrl's feedback-correlator Lambda loads the original explanation from DDB, annotates it with the outcome (accepted/rejected + reason), and writes the annotated narrative to S3 → KB sync. Over time, the KB accumulates positive/negative examples that guide the explainability agent's tone and style.

---

## Data Source Adapter Services

All adapters live in the advisory domain (`services/advisory/<name>`). Each follows the same pattern:
1. EventBridge Scheduler rule triggers the event-publisher Lambda
2. Lambda fetches data from external source
3. If payload fits EventBridge size limit (256 KB): publish event with inline content
4. If payload exceeds limit: write content to the target KB's S3 bucket, publish event with short-lived pre-signed URL (1h TTL)

The consumer service's kb-ingestion-handler Lambda receives the event and either:
- Extracts inline content → writes to S3 bucket → triggers KB sync
- Fetches content from pre-signed URL → writes to S3 bucket → triggers KB sync

### Schedule Configuration

Adapter schedules follow the existing `resolvePipelineConfig` convention — 3-layer merge of hardcoded fallbacks → tier defaults → per-service overrides.

**Tier defaults** (added to `infrastructure/pipeline-defaults.json`):

```json
{
  "sandbox": {
    "schedule": { "enabled": false, "rate": "rate(24 hours)" }
  },
  "staging": {
    "schedule": { "enabled": true, "rate": "rate(24 hours)" }
  },
  "production": {
    "schedule": { "enabled": true, "rate": "rate(6 hours)" }
  }
}
```

- **sandbox** (PR-based environments, manual deploys): schedule deployed in **DISABLED** state. No invocations, zero cost. KB sync triggered manually from AWS console (Bedrock → Knowledge bases → Data source → Sync) or CLI (`aws bedrock-agent start-ingestion-job`).
- **staging**: enabled but conservative rate (24h) to limit API calls.
- **production**: full cadence per adapter.

**Per-adapter `pipeline.json` overrides** (where the adapter needs a different rate than the tier default):

```json
// services/advisory/alpha-vantage-adpt/pipeline.json
{
  "production": {
    "schedule": { "rate": "rate(12 hours)" }
  }
}
```

**In the adapter stack:**

```ts
const config = resolvePipelineConfig(this, 'yahoo-finance-adpt');
const scheduleConfig = config.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new Schedule(this, 'FetchSchedule', {
  schedule: ScheduleExpression.expression(scheduleConfig.rate),
  target: new LambdaInvoke(fetchLambda),
  enabled: scheduleConfig.enabled,
});
```

**Production schedule rates per adapter:**

| Adapter | Production Rate | Rationale |
|---|---|---|
| yahoo-finance-adpt | `rate(6 hours)` | News cycle — 4x/day captures market open/close/overnight |
| marketwatch-adpt | `rate(6 hours)` | Same cadence as Yahoo for headline freshness |
| sec-edgar-adpt | `rate(24 hours)` | Filings don't update intra-day |
| fred-adpt | `rate(24 hours)` | Macro indicators update daily at most |
| alpha-vantage-adpt | `rate(12 hours)` | Conservative — 25 req/day free tier budget |

### 6. yahoo-finance-adpt

**Role:** Fetches financial news from Yahoo Finance RSS feeds for tickers in the investable universe.

**Schedule:** Per-tier config (production: `rate(6 hours)`, staging: `rate(24 hours)`, sandbox: disabled)

**Source:** `feeds.finance.yahoo.com/rss/2.0/headline?s={TICKER}` (RSS/XML, free, no auth)

**Tickers:** VTI, BND, QQQ, VTIP, SPY (configurable via SSM parameter)

**Output event:** `YAHOO_FINANCE_UPDATED`
- Payload: `{ source: 'yahoo-finance', ticker, articles: [{ title, link, pubDate, description }] }`
- Typically fits in 256 KB (RSS feeds return 10-20 articles per ticker)

**Consumer:** market-intelligence-ctrl → KB ingestion

---

### 7. marketwatch-adpt

**Role:** Fetches market headlines and market pulse from MarketWatch RSS feeds.

**Schedule:** Per-tier config (production: `rate(6 hours)`, staging: `rate(24 hours)`, sandbox: disabled)

**Source:**
- `feeds.marketwatch.com/marketwatch/topstories` (RSS)
- `feeds.marketwatch.com/marketwatch/marketpulse` (RSS)

**Output event:** `MARKETWATCH_UPDATED`
- Payload: `{ source: 'marketwatch', feed, articles: [{ title, link, pubDate, description }] }`
- Fits in 256 KB

**Consumer:** market-intelligence-ctrl → KB ingestion

---

### 8. sec-edgar-adpt

**Role:** Fetches SEC filings for ETF issuers and major holdings. Serves multiple consumers with different filing types.

**Schedule:** Per-tier config (production: `rate(24 hours)`, staging: `rate(24 hours)`, sandbox: disabled)

**Source:** `efts.sec.gov/LATEST/search-index` and `data.sec.gov/submissions/CIK{cik}.json` (REST JSON, free, 10 req/sec, User-Agent required)

**Tracked CIKs:**
- Vanguard: `0000102909` (VTI, BND, VTIP)
- BlackRock/iShares: `0000088053`
- Invesco: `0000914208` (QQQ)

**Output events:**

| Event | Filing Types | Content | Consumer |
|---|---|---|---|
| `SEC_8K_FILED` | 8-K | Material events (earnings, M&A, management changes) | market-intelligence-ctrl |
| `SEC_PROSPECTUS_UPDATED` | 485BPOS, N-1A | ETF prospectus updates (holdings, fees, strategy) | portfolio-engine-ctrl |
| `SEC_10K_UPDATED` | 10-K, 10-Q | Annual/quarterly reports with risk factors | portfolio-engine-ctrl |

- 8-K filings: typically fit in 256 KB (inline)
- Prospectuses and 10-K: often exceed 256 KB → write HTML to S3, publish pre-signed URL

---

### 9. fred-adpt

**Role:** Fetches macroeconomic indicators from the Federal Reserve FRED API.

**Schedule:** Per-tier config (production: `rate(24 hours)`, staging: `rate(24 hours)`, sandbox: disabled)

**Source:** `api.stlouisfed.org/fred/series/observations` (REST JSON, free, 120 req/min, API key required but free)

**Series tracked:**

| Series ID | Indicator | Frequency |
|---|---|---|
| FEDFUNDS | Federal Funds Rate | Monthly |
| CPIAUCSL | CPI (inflation) | Monthly |
| DGS10 | 10-Year Treasury Yield | Daily |
| VIXCLS | VIX (volatility index) | Daily |
| SP500 | S&P 500 Index | Daily |
| UNRATE | Unemployment Rate | Monthly |
| DGS1, DGS2, DGS5, DGS30 | Treasury yield curve | Daily |
| BAMLC0A0CM | Corporate bond spread | Daily |

**Output event:** `FRED_INDICATORS_UPDATED`
- Payload: `{ source: 'fred', indicators: [{ seriesId, date, value, label }] }`
- Always fits in 256 KB (small JSON)

**Consumer:** market-intelligence-ctrl → KB ingestion

---

### 10. alpha-vantage-adpt

**Role:** Fetches news sentiment and earnings data from Alpha Vantage free tier.

**Schedule:** Per-tier config (production: `rate(12 hours)` via pipeline.json override, staging: `rate(24 hours)`, sandbox: disabled). Conservative due to 25 req/day free tier limit.

**Source:** `alphavantage.co/query` (REST JSON, free tier, 25 req/day, API key required but free)

**Endpoints used per cycle:**

| Endpoint | Calls | Content |
|---|---|---|
| NEWS_SENTIMENT (top tickers) | ~10 | Sentiment scores + headlines for VTI, BND, QQQ, SPY |
| EARNINGS (if earnings season) | ~5 | Earnings transcripts for major holdings |
| ECONOMIC_INDICATORS | ~5 | GDP, CPI, treasury yields (supplements FRED) |

**Budget management:** With 25 calls/day, the adapter rotates focus:
- Mon-Fri: 15 news sentiment (3 tickers × 5 days) + 5 economic indicators + 5 reserve
- Earnings season override: reduce news to 10, allocate 10 to earnings transcripts

**Output event:** `ALPHA_VANTAGE_NEWS_UPDATED`
- Payload: `{ source: 'alpha-vantage', type: 'news'|'earnings'|'economic', data: [...] }`
- News/economic: fits in 256 KB
- Earnings transcripts: may exceed 256 KB → S3 + pre-signed URL

**Consumer:** market-intelligence-ctrl → KB ingestion

---

## Knowledge Bases

All KBs use **Bedrock built-in vector store** (managed, no external DB required). Content is stored in per-KB S3 buckets and synced via Bedrock KB data source sync.

**S3 bucket naming:** All buckets use environment-prefixed names to avoid global namespace collisions: `{account-id}-{env}-nestfolio-kb-{name}` (e.g., `123456789-dev-nestfolio-kb-market`).

**KB sync latency:** Bedrock KB sync is a batch operation (not real-time). For market data, this means there's a delay between adapter ingestion and RAG availability. This is acceptable because: (1) the market-research agent also has tool Lambdas (market-data, instrument-universe) for real-time structured data, (2) RAG provides qualitative context (news, sentiment) where minutes of latency is fine, (3) KB sync can be triggered programmatically via `StartIngestionJob` API after each S3 write.

### KB 1: Regulatory & Compliance

**S3 Bucket:** `{account}-{env}-nestfolio-kb-regulatory`

**Description:** Regulatory frameworks, suitability rules, and compliance precedents. Enables the risk-assessment agent to cite specific rules and learn from past compliance decisions.

**Static content (one-time upload, quarterly review):**

| Document | Source URL | Format | Size |
|---|---|---|---|
| FINRA Rule 2090 (Know Your Customer) | `finra.org/rules-guidance/rulebooks/finra-rules/2090` | HTML→text | ~5 pages |
| FINRA Rule 2111 (Suitability) | `finra.org/rules-guidance/rulebooks/finra-rules/2111` | HTML→text | ~15 pages |
| SEC Regulation Best Interest | Federal Register 2019-12164 | HTML→text | ~200 pages |
| Investment Advisers Act (eCFR Part 275) | `ecfr.gov/current/title-17/chapter-II/part-275` | HTML→text | ~100 pages |
| MiFID II Articles 24-25 | EUR-Lex CELEX:32014L0065 | HTML→text | ~30 pages |

**Event-ingested content:**

| Trigger | Content written to S3 | Growth rate |
|---|---|---|
| DECISION_BLOCKED (from compliance-ctrl) | Narrative: "Decision {id} blocked: {reason}. Profile: {riskCategory}, concentration: {details}" | ~5-20 docs/month |
| DECISION_APPROVED (from compliance-ctrl) | Narrative: "Decision {id} approved at {authorityLevel}. Profile: {riskCategory}, allocation: {summary}" | ~20-50 docs/month |

**Total corpus:** ~350 pages static + growing precedent history

**Consumer:** investor-profile-ctrl (risk-assessment agent retrieves during inference)

---

### KB 2: Market Intelligence

**S3 Bucket:** `{account}-{env}-nestfolio-kb-market`

**Description:** Market news, sentiment analysis, macroeconomic indicators, and material corporate events. Provides the market-research agent with qualitative context beyond raw price data.

**Static content:** None (this KB is entirely feed-driven)

**Scheduled feed ingestion:**

| Source | Adapter | Schedule | Content Type | Volume |
|---|---|---|---|---|
| Yahoo Finance RSS | yahoo-finance-adpt | Every 6h | News articles per ticker | ~50-100 articles/day |
| MarketWatch RSS | marketwatch-adpt | Every 6h | Market headlines + pulse | ~30-50 articles/day |
| FRED API | fred-adpt | Daily | Macro indicator snapshots | ~12 data points/day |
| Alpha Vantage | alpha-vantage-adpt | Every 12h | News sentiment + earnings | ~10-20 items/day |
| SEC EDGAR 8-K | sec-edgar-adpt | Daily | Material event filings | ~1-5 filings/day |

**Internally generated:**

| Trigger | Content | Growth rate |
|---|---|---|
| MARKET_SIGNAL_DETECTED (own CDC output) | Past market analysis summaries for trend context | ~20-50/month |

**Retention policy:** Rolling 90-day window. Older content is archived to S3 Glacier and removed from KB to keep retrieval relevant.

**Consumer:** market-intelligence-ctrl (market-research agent retrieves during inference)

---

### KB 3: Fund & Instrument

**S3 Bucket:** `{account}-{env}-nestfolio-kb-fund`

**Description:** ETF/fund prospectuses, factsheets, risk factors, and historical allocation rationale. Enables portfolio-construction and rebalance-planner agents to make informed allocation decisions.

**Static content (quarterly refresh via sec-edgar-adpt):**

| Document | Source | Format | Instruments |
|---|---|---|---|
| ETF Prospectuses (Form 485BPOS) | SEC EDGAR | HTML→text | VTI, BND, QQQ, VTIP, SPY |
| Fund Registration (Form N-1A) | SEC EDGAR | HTML→text | Same |
| Annual Reports (10-K risk factors) | SEC EDGAR | HTML→text | Major holdings issuers |
| Quarterly Reports (10-Q) | SEC EDGAR | HTML→text | Major holdings issuers |

**Event-ingested content:**

| Trigger | Content | Growth rate |
|---|---|---|
| SEC_PROSPECTUS_UPDATED (from sec-edgar-adpt) | Updated prospectus filing | ~quarterly |
| SEC_10K_UPDATED (from sec-edgar-adpt) | Updated risk factors | ~quarterly |
| PORTFOLIO_CONSTRUCTION_PROPOSED (own CDC) | Past allocation rationale: "For {riskCategory} profile: {allocation} because {reasoning}" | ~20-50/month |
| ORDER_FILLED (from execution-adpt) | Trade outcome: "Rebalance on {date}: {trades}. Drift corrected from {before}% to {after}%" | ~10-30/month |

**Total corpus:** ~500-1000 pages of filings + growing rationale/outcome history

**Consumer:** portfolio-engine-ctrl (both agents retrieve during inference)

---

### KB 4: Explainability Feedback

**S3 Bucket:** `{account}-{env}-nestfolio-kb-explainability`

**Description:** Financial literacy content, communication templates, and a feedback-driven corpus of past explanations annotated with user acceptance/rejection. This KB starts small and improves over time.

**Static content (one-time upload):**

| Document | Source | License | Size |
|---|---|---|---|
| OpenStax "Principles of Finance" (selected chapters) | `openstax.org/details/books/principles-finance` | CC BY 4.0 | ~200 pages |
| SEC Investor.gov educational guides | `investor.gov/introduction-investing` | Public domain | ~50 pages |
| Personal Finance OER textbook (selected chapters) | `pressbooks.pub/personalfinance` | CC BY 4.0 | ~100 pages |

**Event-ingested content (feedback loop):**

| Trigger | Processing | Content written to S3 |
|---|---|---|
| DECISION_FEEDBACK (from decision-workflow-ctrl, after USER_CONFIRMED) | feedback-correlator loads original explanation from DDB | "ACCEPTED explanation for {riskCategory} investor: {summary}. Tone: {tone}. Length: {wordCount}. Key factors: {factors}" |
| DECISION_FEEDBACK (from decision-workflow-ctrl, after USER_REJECTED) | feedback-correlator loads original + rejection reason | "REJECTED explanation for {riskCategory} investor: {summary}. Reason: {rejectionReason}. Tone: {tone}. Length: {wordCount}" |

**Cold-start strategy:** KB starts with ~350 pages of static educational content. The explainability agent produces useful output from day one using this + prompt engineering. The feedback loop adds refinement over time as real user interactions accumulate.

**Consumer:** advisory-narrative-ctrl (explainability agent retrieves during inference)

---

## Complete Service Map

```
services/advisory/
├── decision-workflow-ctrl/    # Step Functions orchestrator + DecisionPacket owner
├── investor-profile-ctrl/     # user-goals + risk-assessment agents
├── market-intelligence-ctrl/  # market-research agent
├── portfolio-engine-ctrl/     # portfolio-construction + rebalance-planner agents
├── advisory-narrative-ctrl/   # explainability agent
├── advisory-bff/              # (existing — frontend API)
├── compliance-ctrl/           # (existing — approval authority)
├── advisory-adpt/             # (existing — cross-domain adapter)
├── advisory-hub/              # (existing — domain bus + SSM params)
├── yahoo-finance-adpt/        # RSS feed → YAHOO_FINANCE_UPDATED
├── marketwatch-adpt/          # RSS feed → MARKETWATCH_UPDATED
├── sec-edgar-adpt/            # EDGAR API → SEC_8K_FILED, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
├── fred-adpt/                 # FRED API → FRED_INDICATORS_UPDATED
└── alpha-vantage-adpt/        # AV free tier → ALPHA_VANTAGE_NEWS_UPDATED
```

## Event Flow Diagram

```
9 trigger events ──→ decision-workflow-ctrl (Step Functions)
                           │
                           ├── ANALYZE_INVESTOR_PROFILE ──→ investor-profile-ctrl
                           │     ← INVESTOR_PROFILE_COMPLETED      │
                           │                                  [Regulatory KB]
                           │
                           ├── ANALYZE_MARKET ──→ market-intelligence-ctrl
                           │     ← MARKET_ANALYSIS_COMPLETED       │
                           │                                  [Market KB] ←── yahoo-finance-adpt
                           │                                       │    ←── marketwatch-adpt
                           │                                       │    ←── sec-edgar-adpt (8-K)
                           │                                       │    ←── fred-adpt
                           │                                       │    ←── alpha-vantage-adpt
                           │
                           ├── CONSTRUCT_PORTFOLIO ──→ portfolio-engine-ctrl
                           │     ← PORTFOLIO_COMPLETED             │
                           │                                  [Fund KB] ←── sec-edgar-adpt (485BPOS, 10-K)
                           │
                           ├── GENERATE_NARRATIVE ──→ advisory-narrative-ctrl
                           │     ← NARRATIVE_COMPLETED             │
                           │                                  [Explainability KB]
                           │
                           ├── RECOMMENDATION_PROPOSED ──→ compliance-ctrl
                           │     ← DECISION_APPROVED / BLOCKED
                           │
                           ├── USER_CONFIRMATION_REQUESTED ──→ advisory-bff
                           │     ← USER_CONFIRMED / REJECTED
                           │
                           └── END (DecisionPacket final status)
```

## Cost Estimate (POC)

| Component | Count | Monthly Cost |
|---|---|---|
| Bedrock built-in vector store (4 KBs) | 4 | ~$20-50 (storage + queries) |
| Bedrock model invocations (6 agents) | varies | ~$50-200 (depends on volume) |
| DynamoDB tables | 6 | ~$5-10 (on-demand, low volume) |
| S3 buckets | 4 | < $1 |
| Step Functions | 1 state machine | < $1 (standard workflows) |
| Lambda functions | ~20 | < $5 (low invocation count) |
| EventBridge | rules + events | < $1 |
| **Total** | | **~$80-270/mo** |

Compared to the current single-service architecture (~$50-100/mo), the multi-service topology adds ~$30-170/mo primarily from Bedrock KB storage/queries and additional model invocations for RAG retrieval.
