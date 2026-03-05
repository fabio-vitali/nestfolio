# 07 — Production Next Steps

> This document collects work deferred **beyond** the prototype phases (1-5). Only items that are genuinely production-specific remain here. Items useful during the prototype have been moved to their target plan documents.
>
> **Parent document**: [00 — Master Plan](./00-master-plan.md)

---

## Items Pulled into Prototype Phases

The following items were previously tracked here but are now included in prototype plan documents:

| Former ID | Item | Moved To | Prototype Phase |
|---|---|---|---|
| AI-4 | Cost monitoring and budget alarms | [01-foundation.md § 3.7](./01-foundation.md) (CostControls construct) | Phase 1 |
| TI-9 | Zod runtime validation at boundaries | [01-foundation.md § 2.2](./01-foundation.md) (platform-core consumer validation) + AD-21 update | Phase 1 |
| TI-10 | Observability from day one (correlation IDs, dashboards, DLQ alarms) | [05-testing-operations.md](./05-testing-operations.md) | Phase 5 |
| AI-2 | Multi-tenancy adversarial tests | [05-testing-operations.md](./05-testing-operations.md) | Phase 5 |
| TI-8 | Developer experience (Nx generators, mock data factory) | [01-foundation.md](./01-foundation.md) | Phase 1 |
| — | Offline behavior (cached data, staleness, read-only mode) | [04-frontend.md § 2.5](./04-frontend.md) | Phase 4 |
| — | Error state wireframes (API failure, offline, session expired, empty data) | [04-frontend.md](./04-frontend.md) | Phase 4 |
| — | Frontend performance budgets (LCP, bundle size) | [04-frontend.md](./04-frontend.md) | Phase 4 |
| — | Prompt engineering basics (golden datasets, evaluation metrics) | [03-ai-agent-system.md](./03-ai-agent-system.md) | Phase 3 |
| — | All 3 MFE remotes | [04-frontend.md § 1.7](./04-frontend.md) (was "at least one", now all 3) | Phase 4 |

---

## Table of Contents

1. [Post-Prototype Phase Roadmap](#1-post-prototype-phase-roadmap)
2. [Business Validation](#2-business-validation)
3. [Prompt Engineering Methodology](#3-prompt-engineering-methodology)
4. [Full Testing Coverage](#4-full-testing-coverage)
5. [Security Hardening](#5-security-hardening)
6. [Regulatory Compliance](#6-regulatory-compliance)
7. [IBKR Production Integration](#7-ibkr-production-integration)
8. [Simulation-to-Live Transition](#8-simulation-to-live-transition)
9. [Performance Optimization](#9-performance-optimization)
10. [Multi-Region Deployment](#10-multi-region-deployment)
11. [Known Risks & Mitigations](#11-known-risks--mitigations)
12. [Improvement Backlog](#12-improvement-backlog)

---

## 1. Post-Prototype Phase Roadmap

The prototype phases (1-5) each deliver one complete vertical slice per service. The following work covers production readiness after those phases.

> **Note**: The former "Phase 0D -- Full Services" section has been removed. Each service now implements one complete vertical slice during its prototype phase, so a separate "full services" phase is no longer needed.

### Post-Prototype — Integration & Hardening

**Goal**: End-to-end integration testing, operational readiness, rollback validation.

| Deliverable | Description |
|---|---|
| Cross-domain event flow testing | Validate all 6 EventBridge forwarding routes end-to-end |
| Rollback procedure testing | CDK stack rollback (target: <30 min), DynamoDB PITR restore (target: <60 min) |
| Deployment smoke tests | Post-deploy health checks in CI pipeline for every service |
| Log retention policies | 7d/dev, 30d/staging, 90d/prod; compliance logs to S3 for 7-year retention |
| Cost monitoring | ~~Moved to Phase 1~~ — see [01-foundation.md § 3.7](./01-foundation.md). Production adds per-service cost allocation tags and Bedrock hard caps. |
| Error state coverage | ~~Moved to Phase 4~~ — see [04-frontend.md](./04-frontend.md). Production adds additional error scenarios (rate limiting, partial degradation). |
| Revenue model documentation | Finalize pricing strategy and unit economics (see Section 2) |

### IBKR Sandbox Integration

**Goal**: Replace simulation engine with live IBKR paper trading, validate real broker integration.

| Deliverable | Description |
|---|---|
| IBKR institutional account setup | Platform-Managed Authorization Model, compliance documentation |
| WebSocket connection management | Reconnection logic with state catch-up, heartbeat monitoring |
| Order lifecycle handling | Partial fills, cancellations, rejections, amendments |
| Rate limiting strategy | Respect IBKR rate limits for market data and order submission |
| VPC + NAT Gateway | Required for IBKR connectivity |
| Reconciliation against IBKR | Real position reconciliation, corporate actions handling |
| Simulation-to-live transition | Portfolio reset workflow, compliance re-check, user confirmation (see Section 8) |

---

## 2. Business Validation

The platform is being built on market assumptions that remain unvalidated. This section defines the work required to confirm product-market fit and business viability.

### Market Validation

| Activity | Metrics |
|---|---|
| **Landing page test**: Deploy wireframe landing page with "Notify me" email capture. Run targeted Italian-language ads. | Click-through rate, email sign-up conversion, which messaging resonates (trust vs. simplicity vs. AI vs. returns) |
| **User interview sprint**: Interview 10-15 people matching target personas (novice investors, passive savers). | Willingness to delegate to AI, trust threshold, price sensitivity, current investment behavior |
| **Competitor analysis**: Document differentiation from Moneyfarm (~EUR 3B+ AUM), Euclidea, Tinaba, and bank-offered robo-advisory products. | Feature gap matrix, pricing comparison, trust positioning |

**Key question**: Italian savers are extremely conservative (postal savings bonds are dominant). Will they trust AI-managed investments from an unknown brand?

**Differentiation thesis**: "The only robo-advisor that explains every decision in plain language." UX and transparency are the moat, not proprietary technology.

### Revenue Model

Three candidate models, to be validated against user research:

| Model | Typical Range | Pros | Cons |
|---|---|---|---|
| AUM fee | 0.3-1.0% annually | Scales with assets, predictable | Low revenue at small AUM |
| Flat subscription | Monthly fixed fee | Predictable for users, simple | Doesn't scale with assets |
| Hybrid | Base fee + reduced AUM % | Accessible entry point, scales | More complex to communicate |

### Unit Economics

Critical calculation: **minimum viable AUM to break even**. Key factors include AUM fee percentage, partner revenue share, operational costs (AWS, LLM APIs, IBKR fees), customer acquisition cost, and average account size. Model these before committing to a pricing strategy.

### Partner Acquisition Strategy

1. **Build a partner pitch deck** using the prototype (synthetic data, full UX flows)
2. **Target smaller, tech-forward Italian advisory firms (SGR)** rather than large banks -- they have more flexibility and appetite for technology partnerships
3. **Position as "platform as a service"**: the partner brings licenses and clients, Nestfolio provides the technology
4. **Research European investment firm aggregators** that offer partnership programs
5. **Obtain legal pre-validation** of the Platform + Licensed Partner model's regulatory viability before production
6. **Pursue MoU/LoI** (Memorandum of Understanding / Letter of Intent) with at least one partner prospect during the prototype phases

---

## 3. Prompt Engineering Methodology

The plan review (CF-2) identified prompt engineering methodology as a critical gap. Prompt quality is existential: if prompts produce systematically wrong decisions that pass structural validation, the product fails. This section defines the full methodology to be implemented before the AI agents move beyond rules-based (Layer 0) operation.

### Golden Datasets

- Build **50+ test scenarios per agent** covering:
  - Normal operation (various risk profiles, portfolio sizes, market conditions)
  - Edge cases (extreme allocations, minimal portfolios, conflicting constraints)
  - Adversarial inputs (prompt injection attempts, malformed data, boundary values)
  - Historical scenarios (2008 crash, COVID drop, flash crashes) for backtesting agent reasoning
- Store golden datasets as versioned fixtures in the monorepo
- Run golden dataset regression on every prompt change

### Evaluation Metrics

Move beyond schema validation to measure actual decision quality:

| Metric | Description | Target |
|---|---|---|
| Schema compliance rate | Output conforms to Zod schema | >99.5% |
| Guardrail pass rate | Decisions pass all 6 defense-in-depth layers | >99% |
| Deterministic fallback rate | How often the agent falls back to rules-based output | <10% in steady state |
| Confidence calibration | Agent confidence scores correlate with actual outcome quality | r > 0.7 |
| Semantic accuracy | Expert-reviewed correctness of reasoning (sampled) | >90% on sample set |
| Hallucination rate | Fabricated market events, nonexistent citations, incorrect figures | <1% |
| Decision consistency | Same input produces semantically equivalent output across runs | >85% |

### Few-Shot Learning Strategy

- Each agent prompt includes 2-3 curated examples from the golden dataset
- Examples cover: ideal output, edge case handling, constraint-respecting output
- Examples are rotated/versioned alongside the prompt template
- Track few-shot effectiveness: compare accuracy with and without examples

### A/B Testing Infrastructure

- Shadow mode: new prompt versions run in parallel with production, outputs compared but not acted upon
- Gradual rollout: 10% -> 25% -> 50% -> 100% traffic to new prompt version
- Automatic rollback trigger: if guardrail pass rate drops below threshold or fallback rate spikes

### Prompt Governance Workflow

1. **Proposal**: Developer drafts prompt change with rationale
2. **Golden dataset evaluation**: Run change against full golden dataset, generate comparison report
3. **Staged rollout**: Deploy to dev -> staging (shadow mode) -> production (gradual rollout)
4. **Monitoring**: 24-hour observation window at each stage with automated alerting
5. **Rollback**: One-command revert to previous prompt version via versioned prompt storage

### Model Behavior Change Detection

Bedrock model updates could silently alter agent behavior. Mitigate by:
- Running golden dataset regression weekly (even without prompt changes)
- Alerting on output distribution shifts (confidence score distribution, token count changes)
- Pinning Bedrock model versions where possible

---

## 4. Full Testing Coverage

The prototype phases deliver minimal testing. This section defines the complete testing strategy required for production, absorbing gaps identified in the plan review (Sections 8.3, 8.4).

### Unit Testing (Target: 70% coverage)

| Area | Focus | Tools |
|---|---|---|
| Lambda handlers | Event processing logic, DynamoDB key construction, tenant isolation | Jest + Awilix DI |
| AI agents | Prompt template rendering, Zod schema validation, fallback logic | Jest + deterministic fixtures |
| Frontend components | Component rendering, state management, form validation | Vitest (with Vitest-Angular fallback budget) |
| Shared libraries | Event-processing library, CDK constructs, type utilities | Jest |

**Key gap to address**: Vitest-Angular integration is experimental. Have a fallback plan to Jest if needed.

### Integration Testing

| Area | Focus | Tools |
|---|---|---|
| **Contract testing for EventBridge schemas** | Validate event payloads against JSON Schema contracts on every commit | Custom JSON Schema validation in CI |
| **EventBridge rule pattern matching** | Verify rules route events to correct targets | AWS dev account + custom test harness |
| **DynamoDB access patterns** | Verify all GSI queries return expected results for all entity types | AWS dev account + test data factory |
| **AppSync resolvers** | Verify resolver logic, tenant filtering, subscription authorization | AWS dev account + integration test suite |
| **Cross-domain event flows** | End-to-end event propagation across all 3 EventBridge buses | AWS dev account + correlation ID tracing |

**Note**: The prototype phases use direct AWS dev account testing (no LocalStack). For production, evaluate whether LocalStack Pro would improve CI speed for the expanded test suite.

### End-to-End Testing

| Flow | Scope | Tools |
|---|---|---|
| Onboarding | Registration -> risk assessment -> portfolio creation -> initial allocation | Playwright |
| Decision lifecycle | Market trigger -> agent pipeline -> compliance check -> execution -> confirmation | Playwright + API assertions |
| Portfolio monitoring | Dashboard load -> real-time subscription -> portfolio update display | Playwright |
| Error scenarios | API failure, offline, session expiry, empty data, invalid input (5+ flows) | Playwright |

**E2E test data management**: Define a strategy for seeding and cleaning test data. Use dedicated test tenants with automated teardown.

### Accessibility Testing

| Standard | Scope | Tools |
|---|---|---|
| WCAG 2.1 AA compliance | All 14+ screens | axe-core integrated into Playwright |
| Keyboard navigation | Full application navigable without mouse | Manual + automated testing |
| Screen reader | ARIA labels, live regions for real-time updates | NVDA/VoiceOver manual testing |
| Color contrast | All text meets 4.5:1 ratio (already in design system) | Lighthouse CI |

### Load Testing

| Scenario | Target | Tools |
|---|---|---|
| Concurrent portfolio decisions | 100 simultaneous decision lifecycles | k6 or Artillery |
| Market event spike | 1000 events/minute through EventBridge pipeline | Custom load generator + CloudWatch |
| Frontend performance | LCP < 2.5s, bundle size budgets per MFE | Lighthouse CI in pipeline |
| Bedrock / AgentCore throughput | Sustained 50 agent invocations/minute without rate limiting | Custom stress test |

### Frontend Testing Allocation

The plan review identified zero testing allocation for the frontend. Add frontend testing to the scope:

| Activity | Days |
|---|---|
| Unit tests for shared components | 4-5 |
| E2E flows (Playwright) | 5-6 |
| Accessibility audit and fixes | 3-4 |
| Error state implementation and testing | 3-5 |

---

## 5. Security Hardening

Financial software demands rigorous security. This section covers work deferred from the prototype phases, absorbing TW-2 from the risk analysis and security findings from the review.

### OWASP Top 10 Audit

Conduct a systematic audit against the OWASP Top 10 for serverless applications:

| OWASP Category | Nestfolio Relevance | Priority |
|---|---|---|
| A01: Broken Access Control | Multi-tenant isolation (tenant_id enforcement at every layer), Cognito authorization | Critical |
| A02: Cryptographic Failures | Encryption at rest (DynamoDB, S3), in transit (TLS), secret management (Secrets Manager) | High |
| A03: Injection | Prompt injection (see below), DynamoDB injection (parameterized queries), GraphQL injection | Critical |
| A04: Insecure Design | Threat modeling for financial workflows, defense-in-depth for AI decisions | High |
| A05: Security Misconfiguration | Lambda IAM least privilege, S3 bucket policies, EventBridge resource policies | High |
| A07: Auth Failures | Cognito configuration review, token expiration, session management | High |
| A08: Data Integrity Failures | Event sourcing integrity, EditEvent chain validation, audit trail immutability | High |
| A09: Logging & Monitoring | Security event alerting, failed auth tracking, anomaly detection | Medium |

### Prompt Injection Defense

LLM-powered financial agents are vulnerable to prompt injection through user-supplied text. This is a critical attack vector.

**Attack surfaces**:
- User-supplied goal text and investment preferences injected into agent prompts
- Market data poisoning (if external feeds contain adversarial content)
- Cross-tenant context leakage (one tenant's data influencing another's agent reasoning)

**Defenses**:
1. **Input sanitization**: Strip or escape control characters, XML/HTML tags, and known prompt injection patterns from all user-supplied text before LLM prompt inclusion
2. **Prompt structure**: Use clear system/user message boundaries; user-supplied content always in designated user message sections, never in system prompts
3. **Output validation**: All agent outputs validated against Zod schemas and guardrail rules regardless of prompt content
4. **Monitoring**: Log and alert on unusual output patterns that may indicate successful injection
5. **Isolation**: Each tenant's agent invocation uses a fresh context; no shared state between tenant invocations

### Secret Rotation Procedures

| Secret | Rotation Strategy | Frequency |
|---|---|---|
| Bedrock access credentials | IAM role rotation (managed by AWS) | Automatic |
| IBKR credentials | Manual rotation with documented runbook | 90 days |
| Cognito client secrets | Rotation via CDK deployment | On change |
| Database encryption keys | AWS-managed KMS automatic rotation | Annual |

**Procedure**: Document step-by-step runbooks for each rotation, test rotation in staging before production, automate where possible.

### Penetration Testing

- Schedule external penetration test before any live-money operation (production gate)
- Scope: API endpoints, authentication flows, multi-tenant isolation, AppSync subscriptions
- Include LLM-specific testing (prompt injection, output manipulation)
- Engage professional penetration testing firm

---

## 6. Regulatory Compliance

The entire business model depends on the Platform + Licensed Partner structure. Without a licensed investment advisor partner, Nestfolio cannot legally operate in any EU jurisdiction. This section defines the compliance work required.

### Licensed Partner Acquisition

**Status**: No partner secured. This is the single biggest business risk (BW-1).

| Action | Phase | Owner |
|---|---|---|
| Legal pre-validation of Platform + Licensed Partner model | Before production | External legal counsel |
| Partner pitch deck using prototype | During prototype phases | Developer |
| Outreach to 5-10 smaller Italian SGR firms | During prototype phases | Developer |
| MoU/LoI with at least one prospect | Before production launch | Developer + legal |
| Formal partnership agreement | Before any live-money operation | Legal counsel |

**Risk**: Partners may demand revenue-sharing terms that erode margins, require control over AI decision parameters, or impose requirements not yet reflected in the architecture. The architecture must remain flexible to accommodate unknown partner requirements.

### KYC/AML Implementation

| Requirement | Implementation | Notes |
|---|---|---|
| Identity verification | Integration with KYC provider (e.g., Onfido, Jumio) | Partner may dictate provider |
| Sanctions screening | Real-time screening against EU/UN sanctions lists | Automated, with manual review escalation |
| PEP (Politically Exposed Persons) checks | Integrated into onboarding flow | Ongoing monitoring required |
| Transaction monitoring | Suspicious activity detection and reporting | Required by Italian AML regulations |
| Record retention | All KYC documents retained for 10 years | S3 with lifecycle policies |

### Audit Trail Retention

| Data Type | Retention Period | Storage | Rationale |
|---|---|---|---|
| Compliance decision logs | 7 years | S3 (Glacier after 1 year) | EU financial services regulation |
| Investment decision audit trail | 7 years | S3 (Glacier after 1 year) | MiFID II record-keeping |
| KYC/AML documents | 10 years | S3 (Glacier after 1 year) | Italian AML directive |
| User activity logs | 2 years | CloudWatch -> S3 | GDPR data minimization |
| System operational logs | 90 days (prod) | CloudWatch | Operational needs |

### GDPR Data Protection Impact Assessment (DPIA)

A DPIA is required because Nestfolio processes:
- Financial data (special category under GDPR interpretation by Italian DPA)
- Automated decision-making affecting individuals (AI-driven investment decisions)
- Profiling (risk assessment, investment preferences)

| DPIA Component | Description |
|---|---|
| Processing description | Document all personal data flows through the 14 services |
| Necessity assessment | Justify data collection for each field against business purpose |
| Risk assessment | Identify risks to data subjects (breach, misuse, profiling errors) |
| Mitigation measures | Encryption, access controls, data minimization, right to human review |
| DPO consultation | Engage Data Protection Officer (partner obligation or external) |

---

## 7. IBKR Production Integration

Interactive Brokers integration is the critical path for production. IBKR's API is notoriously difficult, and the plan review elevated this from High to Critical severity. This section defines the full integration scope.

### Institutional Account Setup

| Requirement | Description | Status |
|---|---|---|
| Account type | Institutional / Platform-Managed Authorization Model | Research needed |
| Compliance documentation | IBKR requires specific compliance docs for institutional accounts | Not started |
| API access level | Determine required permissions (trading, market data, account management) | Not started |
| Paper trading environment | Set up IBKR paper trading for post-prototype development | Spike recommended |

**Recommended action**: Conduct an IBKR feasibility spike during the later prototype phases (before production) to validate account setup requirements and API capabilities. This avoids discovering blockers late.

### WebSocket Reliability

IBKR WebSocket connections are known for frequent disconnects. The integration must handle:

| Scenario | Strategy |
|---|---|
| Connection drop | Automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s) |
| State catch-up | On reconnect, query current positions/orders to reconcile local state |
| Heartbeat monitoring | Detect stale connections before IBKR timeout (5-minute keepalive) |
| Connection state tracking | Expose connection health to operations dashboard |
| Graceful degradation | Queue orders during disconnection, replay on reconnect (with staleness check) |

### Order Lifecycle Edge Cases

| Edge Case | Handling Strategy |
|---|---|
| Partial fills | Track fill quantity, update portfolio proportionally, decide whether to leave remainder or cancel |
| Cancellations | Handle broker-initiated cancellations (market closed, invalid instrument), retry or escalate |
| Rejections | Parse rejection reason, categorize (transient vs permanent), route to appropriate recovery |
| Amendments | Support order modification for price/quantity changes before fill |
| Corporate actions | Detect stock splits, dividends, mergers; adjust positions and historical data |
| Market halts | Detect trading halts, pause order submission, notify user |
| Currency conversion | Handle multi-currency positions (EUR-denominated accounts with USD assets) |

### Rate Limiting Strategy

| API Endpoint | IBKR Limit | Strategy |
|---|---|---|
| Market data subscriptions | 100 concurrent | Priority queue based on active portfolio holdings |
| Order submission | 50/second | Token bucket rate limiter, queue excess orders |
| Account queries | 1/second | Cache with 5-second TTL, batch where possible |
| Historical data | 6 requests/2 seconds | Request queue with backpressure |

---

## 8. Simulation-to-Live Transition

The transition from simulation mode to live trading is one of the highest-risk moments in the product lifecycle. The plan review (CF-5, MR-1) identified this as a critical gap.

### Transition Workflow

```
1. Pre-Transition Checks
   |-- Verify licensed partner agreement is active
   |-- Verify KYC/AML status is APPROVED
   |-- Verify risk profile is current (not expired)
   |-- Verify compliance rules are configured for live trading
   |-- Verify IBKR account is provisioned and connected

2. Portfolio Reset
   |-- Snapshot simulation portfolio state (for reference)
   |-- Clear simulation positions and virtual ledger
   |-- Initialize live portfolio with zero positions
   |-- Recalculate target allocation based on current market data

3. IBKR Account Provisioning
   |-- Create sub-account under institutional umbrella
   |-- Set trading permissions and instrument restrictions
   |-- Configure market data subscriptions
   |-- Verify connectivity and order routing

4. Compliance Re-Check
   |-- Run full compliance validation against live trading rules
   |-- Verify all regulatory requirements are met
   |-- Generate compliance approval record (audit trail)

5. User Confirmation Flow
   |-- Present transition summary (what changes, what's preserved)
   |-- Display risk acknowledgment (simulation performance != live performance)
   |-- Require explicit consent with digital signature
   |-- Set account_mode = 'LIVE' in TenantContext

6. Post-Transition Monitoring
   |-- 24-hour enhanced monitoring window
   |-- Reduced position limits for first week
   |-- Manual review of first 5 trades
   |-- Automated alerting on any anomaly
```

### Key Risks During Transition

| Risk | Mitigation |
|---|---|
| User expects simulation returns to continue in live mode | Clear disclaimers, mandatory acknowledgment, remove simulation performance history from live dashboard |
| State migration errors (positions, orders, preferences) | Preferences and risk profile carry over; positions do NOT carry over (clean start) |
| Simulation fidelity gap surprises users | Document known differences (slippage, execution speed, partial fills) in transition materials |
| Legal exposure from implicit performance promises | Legal review of all transition copy, mandatory risk disclosures |

---

## 9. Performance Optimization

### Decision Latency

Target: **<10 seconds end-to-end** for the full decision lifecycle (market trigger -> agent pipeline -> compliance -> execution confirmation).

| Component | Current Estimate | Target | Optimization |
|---|---|---|---|
| Agent invocation (per agent) | 1-5 seconds | 1-2 seconds | Prompt caching, Bedrock model selection, parallel agent execution where possible. AgentCore Runtime handles scaling, versioning, and lifecycle management. |
| Step Functions overhead | ~100ms per state transition | <100ms | Minimize state transitions, use Express Workflows for synchronous paths |
| EventBridge propagation | 200-500ms | <300ms | Direct invocation for latency-critical paths |
| DynamoDB reads/writes | 5-20ms | <10ms | DAX caching for hot read paths |
| Total pipeline | 10-30 seconds | <10 seconds | Parallel execution, caching, optimized prompts |

### Frontend Performance Budgets

| Metric | Target | Measurement |
|---|---|---|
| Largest Contentful Paint (LCP) | <2.5 seconds | Lighthouse CI in pipeline |
| First Input Delay (FID) | <100ms | Lighthouse CI |
| Cumulative Layout Shift (CLS) | <0.1 | Lighthouse CI |
| Bundle size (shell) | <150KB gzipped | Webpack bundle analyzer |
| Bundle size (per MFE) | <100KB gzipped | Webpack bundle analyzer |
| Time to Interactive (TTI) | <3.5 seconds | Lighthouse CI |

### Prompt Caching Strategy

Bedrock prompt caching could save **50-70% on input token costs** for repeated prompt structures.

| Strategy | Description | Savings Estimate |
|---|---|---|
| System prompt caching | Cache the static system prompt portion across agent invocations | 50-60% of input tokens |
| Context bundle caching | Cache frequently-used context bundle components (risk profiles, allocation constraints) | 10-20% of input tokens |
| Few-shot example caching | Cache few-shot examples that don't change between invocations | 5-10% of input tokens |

**Implementation**: Use Bedrock's prompt caching capabilities. Structure prompts with static content first, dynamic content last.

### Lambda Cold Start Optimization

| Optimization | Impact | Effort |
|---|---|---|
| Provisioned concurrency for critical Lambda paths (execution-adpt) | Eliminates cold starts entirely | $$ (always-on cost). Note: advisory-ctrl agents run on AgentCore Runtime, which handles its own scaling and warm-up. |
| Bundle size reduction (tree-shaking, dependency audit) | Reduces cold start duration by 30-50% | Medium |
| SnapStart (if available for Node.js) | Reduces cold start to ~200ms | Low (configuration only) |
| Warm-up scheduled events | Keep critical Lambdas warm via CloudWatch scheduled rules | Low |
| Monitor cold start rate | Dashboard metric, alert if >5% of invocations are cold starts | Low |

---

## 10. Multi-Region Deployment

The prototype deploys to a single AWS region (eu-south-1, Milan). Production requires disaster recovery and resilience planning.

### DR Strategy

| Metric | Target | Rationale |
|---|---|---|
| Recovery Time Objective (RTO) | <4 hours | Financial services expectation; users can tolerate brief outage if positions are safe |
| Recovery Point Objective (RPO) | <1 hour | Acceptable data loss window for non-trading data; zero for executed orders |
| Backup region | eu-west-1 (Ireland) | Mature AWS region, GDPR-compliant, good latency to Italian users |

### Cross-Region Replication

| Service | Replication Strategy |
|---|---|
| DynamoDB | Global Tables (active-active replication, <1 second latency) |
| S3 (compliance logs, documents) | Cross-Region Replication (CRR) with versioning |
| Cognito | User pool cannot be replicated; maintain standby pool in backup region, sync via Lambda trigger |
| EventBridge | Event replay from archive in backup region; consider cross-region event bus forwarding |
| AppSync | Separate deployment in backup region; Route 53 health-check failover |
| Step Functions | Stateful; requires re-initiation of in-flight workflows after failover |

### Multi-AZ Lambda

Lambda is inherently multi-AZ within a region. Additional considerations:

| Concern | Strategy |
|---|---|
| VPC-attached Lambdas (IBKR connectivity) | Deploy subnets in 3 AZs, NAT Gateway in each AZ for HA |
| DynamoDB AZ resilience | Built-in (multi-AZ by default); Global Tables for cross-region |
| Single-AZ failure | No action needed for Lambda/DynamoDB; ensure VPC spans 3 AZs |

### Operational Gaps to Address

| Gap | Action |
|---|---|
| No disaster recovery targets defined | Define RTO/RPO as above, document in runbooks |
| Incident tracking location undefined | Establish incident tracking (PagerDuty or OpsGenie for solo dev) |
| Runbook location undefined | Store runbooks in `/docs/runbooks/` in the monorepo |
| Capacity planning absent | Define scaling limits per service, set CloudWatch alarms at 80% thresholds |

---

## 11. Known Risks & Mitigations

This section absorbs ALL content from the archived `06-weaknesses-risks.md` and adds missing risks (MR-1 through MR-9) and severity recalibrations from `09-plan-review.md`.

### Risk Matrix

| ID | Risk | Probability | Impact | Category |
|---|---|---|---|---|
| BW-1 | No licensed partner secured | High | Critical | Business |
| BW-2 | Solo dev capacity exceeded / burnout | High | **Critical** (upgraded) | Business |
| BW-3 | No market validation | Medium | **Medium** (downgraded) | Business |
| BW-4 | Single broker dependency (IBKR) | Low | High | Business |
| BW-5 | Revenue model undefined | Medium | High | Business |
| TW-2 | LLM hallucination in financial decisions | Medium | Critical | Technical |
| TW-3 | Event-processing library issues (Highland.js) | Medium | High | Technical |
| TW-4 | Angular microfrontend complexity | Medium | Medium | Technical |
| TW-9 | IBKR integration harder than expected | High | **Critical** (upgraded) | Technical |
| TW-1 | Event-driven architecture ops overhead | Medium | Medium | Technical |
| TW-5 | AppSync limitations hit | Low | Medium | Technical |
| TW-6 | DynamoDB single-table design constraints | Low | Medium | Technical |
| TW-7 | Multi-tenancy premature complexity | Low | Low | Technical |
| TW-8 | Step Functions cost/complexity | Low | Medium | Technical |
| TW-10 | Cognito limitations | Low | Medium | Technical |
| MR-1 | Simulation-to-live transition failures | Medium | High | Technical |
| MR-2 | Context window management degradation | Medium | Medium | Technical |
| MR-3 | Developer burnout (decision fatigue, isolation) | High | Critical | Business |
| MR-4 | AWS service limits hit | Low | Medium | Technical |
| MR-5 | Prompt injection attacks | Medium | High | Technical |
| MR-6 | IBKR API deprecation / breaking changes | Medium | Medium | Technical |
| MR-7 | LLM cost overruns (volatility spikes) | Medium | Medium | Technical |
| MR-8 | Reconciliation false positives | Medium | Medium | Technical |
| MR-9 | Regulatory partner scope creep | Medium | High | Business |

### Business Risks — Detail

#### BW-1: Regulatory Dependency Is Existential

The entire business model depends on the Platform + Licensed Partner structure. Without a licensed investment advisor partner, Nestfolio cannot legally operate in any EU jurisdiction.

- **Impact**: No partner = no launch
- Licensed partners may demand revenue-sharing terms that erode margins
- Partners may require control over AI decision parameters, constraining the product vision
- Partner regulatory obligations may impose requirements not yet reflected in the architecture
- The partner relationship creates a single point of business failure
- Time to secure a partner is unpredictable and outside the developer's control

**Mitigation**: Building the technical platform first creates a demonstrable product for partner conversations. Architecture must remain flexible for unknown partner requirements. Pursue parallel partner pipeline + legal pre-validation + MoU/LoI.

**Weak mitigation warning**: No concrete partner acquisition pipeline exists yet. Needs explicit strategy (see Section 2).

#### BW-2: Solo Developer Capacity (UPGRADED to CRITICAL)

The system has 14 services, 3 domains, 6 AI agents, microfrontend architecture, real-time subscriptions, multi-tenant isolation, event sourcing, CQRS, reconciliation pipelines, and compliance audit trails. This is a system typically built by a team of 8-15 engineers. Bus factor = 1 is existential.

- **Impact**: Burnout and project abandonment, quality compromises, knowledge concentration
- Decision fatigue from constant context switching across backend, frontend, AI, infrastructure, and DevOps
- Isolation: no code review, no architectural discussion, no second opinion
- Health impact from sustained intense work (projected 8-12 months)

**Mitigation**: AI-assisted development increases velocity but doesn't eliminate cognitive overhead. Strict vertical-slice delivery and ruthless scope discipline are essential. Progressive architecture (3 super-services) reduces initial complexity.

**Weak mitigation warning**: "AI-assisted development" is insufficient alone. Explicit scope reduction is mandatory.

#### BW-3: Market Validation Deferred (DOWNGRADED to MEDIUM)

Building without market validation risks months of wasted effort. Target personas are hypothetical. Italian market for robo-advisory is small and dominated by established players. Trust in AI-managed money requires significant brand building.

**Mitigation**: Platform can be pivoted to adjacent use cases. Run lean market validation in parallel (see Section 2). The prototype serves as a reference implementation for partner discussions.

#### BW-4: Single Broker Dependency (IBKR)

Vendor lock-in with IBKR. API changes, account termination, or institutional requirements could threaten operations. Known API reliability issues (WebSocket disconnects, rate limiting, partial fills).

**Mitigation**: Build broker abstraction layer to enable future multi-broker support. Document IBKR-specific assumptions explicitly.

#### BW-5: Revenue Model Undefined

No revenue model defined in specifications. Key unknowns: fee structure, partner revenue split, minimum viable AUM, break-even analysis.

**Mitigation**: Define revenue model and validate unit economics before production investment (see Section 2).

#### MR-3: Developer Burnout (NEW — CRITICAL)

Beyond BW-2's capacity concern, burnout manifests as: decision fatigue, context switching tax, professional isolation, physical and mental health impact from sustained solo work on a complex system.

**Mitigation**: Set hard weekly hour limits (45 max), schedule regular breaks, maintain non-work activities, consider part-time collaborator post-prototype.

#### MR-9: Regulatory Partner Scope Creep (NEW — HIGH)

After a partnership agreement is signed, the partner may introduce new requirements that were not anticipated during architecture design. A solo developer has limited leverage to push back.

**Mitigation**: Architecture flexibility (event-driven, service-oriented), clear technical boundaries in partnership agreement, explicit change management process.

### Technical Risks — Detail

#### TW-2: LLM-Powered Financial Agents Are Inherently Risky

This is the highest-risk technical decision in the project. LLMs can hallucinate incorrect financial recommendations, are non-deterministic (complicating audit replay), are vulnerable to prompt injection, have unpredictable costs, add latency (1-5s per agent), and face regulatory explainability concerns.

**Mitigation**: Rules-first AI strategy (Layer 0 deterministic, Layer 1 LLM-assisted, Layer 2 LLM-powered). Deterministic guardrails always active as safety net. Golden dataset testing. Semantic hallucination detection.

#### TW-9: IBKR Integration (UPGRADED to CRITICAL)

IBKR's API has: frequent WebSocket disconnects requiring reconnection with state catch-up, complex order lifecycle (partial fills, cancellations, rejections, amendments), strict rate limits, incomplete/outdated documentation, sandbox that doesn't perfectly replicate production, and complex institutional account setup.

**Mitigation**: Build broker abstraction layer. Conduct feasibility spike during later prototype phases. Plan for IBKR unknowns.

**Weak mitigation warning**: No concrete mitigation existed in original plan. Needs abstraction layer + early spike (see Section 7).

#### TW-1: Event-Driven Architecture Overhead

Three EventBridge buses, 6 cross-domain forwarding routes, SQS queues with DLQs, DynamoDB Streams CDC, and event sourcing create significant operational complexity for a solo developer. Debugging distributed traces is hard. LocalStack emulates imperfectly. 14+ CDK stacks to deploy.

**Mitigation**: Progressive architecture (start with 3 super-services). Invest in observability from day one. Use correlation IDs across all event flows.

#### TW-3: Event-Processing Library Patterns

The backend depends on Highland.js-based stream processing patterns ported from `@event-lab/event-processor` into `libs/platform-core`. Highland.js has low maintenance activity. Every Lambda handler depends on these patterns.

**Mitigation**: Patterns are proven in the event-lab project. Keep the API surface minimal. Build escape hatches (ability to replace with direct handler code). Comprehensive unit testing. Contract tests for the public API (following event-lab's `public-api.spec.ts` pattern).

#### TW-4: Angular Microfrontend Complexity

Angular microfrontend architecture is less mature than React's ecosystem. Build tooling sensitivity (esbuild transition), larger baseline bundle size, shared dependency management complexity, and narrower AppSync integration options.

**Mitigation**: All 3 MFE remotes are implemented in the prototype (Phase 4) using Native Federation. This validates the full pattern early. Nx library boundaries enforce domain separation. See [04-frontend.md § 1.7](./04-frontend.md).

#### TW-5: AppSync Limitations

Maximum 100 subscriptions per connection, 240KB payload limit, 5-minute keepalive timeout, multi-API composition challenges (3 AppSync APIs with no built-in federation), limited local testing support.

**Mitigation**: Design within limits. Monitor subscription counts. Consider Apollo Federation if multi-API composition becomes painful.

#### TW-6: DynamoDB Single-Table Design Trade-offs

Access pattern rigidity (max 20 GSIs), debugging difficulty with mixed entity types, schema evolution complexity, hot partition risk, event sourcing storage overhead.

**Mitigation**: Document all access patterns upfront. Monitor partition metrics. Plan migration strategy for schema evolution.

#### TW-7: Multi-Tenancy May Be Premature

Tenant_id at every layer adds development overhead for the prototype phases with no real users. Every query needs tenant filtering, every event carries tenant context, every resolver enforces isolation.

**Mitigation**: The overhead is justified — retrofitting multi-tenancy is extremely painful. Accept near-term cost for long-term correctness.

#### TW-8: Step Functions Complexity

Expensive at scale (per-state-transition pricing), 25,000 event history limit, hard to test locally, adds ~100ms per state transition.

**Mitigation**: Use Step Functions only where workflow has >3 steps with branching/parallel execution/external wait states. Use Lambda orchestration for simpler workflows.

#### TW-10: Cognito Limitations

Many settings immutable after pool creation, complex custom auth flows, limited UI customization, password hashes not exportable (migration difficulty).

**Mitigation**: Careful upfront configuration. Document all Cognito settings. Plan for potential migration to Auth0/Clerk if Cognito becomes a constraint.

#### MR-1: Simulation-to-Live Transition (NEW — HIGH)

State migration complexity, user expectation mismatch (simulation performance != live performance), simulation fidelity gaps, legal exposure from implicit performance promises.

**Mitigation**: Clean portfolio start (no position carry-over). Mandatory risk acknowledgment. Enhanced monitoring window. See Section 8.

#### MR-2: Context Window Management (NEW — MEDIUM)

As accounts age, decision context grows. Context window limits force summarization, which may lose critical decision continuity. Summary drift over time could degrade decision quality.

**Mitigation**: Structured context bundles with explicit summarization rules. Monitor context bundle size trends. Periodic human review of summarized context accuracy.

#### MR-4: AWS Service Limits (NEW — MEDIUM)

EventBridge targets per rule (5 default), AppSync concurrent connections, Lambda concurrency, DynamoDB GSIs (20 max). May hit limits as usage grows.

**Mitigation**: Request limit increases proactively. Monitor usage against limits. Design within default limits where possible.

#### MR-5: Prompt Injection (NEW — HIGH)

User-supplied goal text could manipulate agent reasoning. Market data poisoning if external feeds contain adversarial content. Cross-tenant context leakage potential.

**Mitigation**: Input sanitization, prompt structure isolation, output validation, monitoring. See Section 5.

#### MR-6: IBKR API Deprecation (NEW — MEDIUM)

IBKR has a history of breaking API changes with limited deprecation notice. A breaking change could block trading operations.

**Mitigation**: Broker abstraction layer. Pin to specific API versions. Monitor IBKR changelog. Maintain test suite against IBKR sandbox.

#### MR-7: LLM Cost Overruns (NEW — MEDIUM)

Market volatility could trigger thousands of portfolio rebalances, spiking Bedrock invocation costs 3-5x. Runaway agent loops or context bundle size creep could amplify costs.

**Mitigation**: Hard budget caps on Bedrock API spend. Agent invocation rate limiting. Circuit breakers on agent loops. Prompt caching to reduce per-invocation cost.

#### MR-8: Reconciliation False Positives (NEW — MEDIUM)

Timing mismatches between IBKR state and local state, corporate actions, and currency rounding could generate false reconciliation alerts, eroding trust in the system.

**Mitigation**: Configurable reconciliation tolerances. Separate handling for corporate actions. Currency rounding rules documented and tested.

---

## 12. Improvement Backlog

This section absorbs ALL content from the archived `07-improvements.md` and adds improvements (AI-1 through AI-5) from `09-plan-review.md`. Items are organized by priority.

### Items Now Addressed in Plan Documents

The following items previously tracked here are now covered by the updated plan documents:

| Item | Now Addressed By |
|---|---|
| Event schema governance | AD-21 in master plan (producer exports + consumer validates) |
| Platform/domain library separation | AD-18 in master plan (ported from event-lab event-processor) |
| Compliance rule registry pattern | Plan document 03 |
| Local development story | AD-16 in master plan |
| Cost monitoring (AI-4) | 01-foundation.md § 3.7 (CostControls construct, Phase 1) |
| Zod runtime validation (TI-9) | 01-foundation.md § 2.2 (platform-core consumer validation, Phase 1) |
| Observability from day one (TI-10) | 05-testing-operations.md (Phase 5) |
| Multi-tenancy adversarial tests (AI-2) | 05-testing-operations.md (Phase 5) |
| Developer experience infrastructure (TI-8) | 01-foundation.md (Phase 1) |
| Offline behavior | 04-frontend.md § 2.5 (Phase 4) |
| MFE remotes (all 3) | 04-frontend.md § 1.7 (Phase 4) |

### Critical Priority

| ID | Improvement | Impact | Description |
|---|---|---|---|
| BI-1 | Lean market validation | Avoids building wrong product | Landing page test with Italian-language ads measuring click-through and email sign-up conversion. User interview sprint (10-15 people matching target personas). Competitor analysis documenting differentiation from Moneyfarm, Euclidea, Tinaba. |
| TI-2 | Rules-first AI strategy (Hybrid AI) | Eliminates prototype AI risk, reduces complexity | Build each agent in 3 layers: Layer 0 (deterministic rules for prototype), Layer 1 (LLM-assisted for early production), Layer 2 (LLM-powered for mature production). Deterministic rules become the permanent safety net. |
| AI-2 | ~~Multi-tenancy adversarial tests~~ | ~~Moved to Phase 5~~ | See 05-testing-operations.md |

### High Priority

| ID | Improvement | Impact | Description |
|---|---|---|---|
| BI-2 | Define revenue model | Business viability clarity | Document fee structure (AUM-based, flat subscription, or hybrid). Calculate minimum viable AUM. Model break-even scenarios with different partner revenue splits. |
| BI-3 | Partner acquisition strategy | Unblocks business launch | Build partner pitch deck from prototype. Target smaller Italian SGR firms. Position as platform-as-a-service. Pursue MoU/LoI before production launch. Legal pre-validation of regulatory model. |
| TI-1 | Progressive architecture | Faster prototype delivery, prevents burnout | Start with 3 super-services (one per domain) instead of 14. Each contains constituent service logic as internal modules. Same event-driven patterns, fewer CDK stacks. Extract services as they grow. |
| TI-8 | ~~Developer experience infrastructure~~ | ~~Moved to Phase 1~~ | See 01-foundation.md |
| AI-1 | Simulation mode fidelity validation | Prevents false confidence in sim results | Backtest simulation engine against historical market data. Add realistic friction (slippage, execution delay, partial fills). Document known simulation-to-live fidelity gaps. |
| AI-5 | IBKR sandbox dry run | De-risks production | Spike during later prototype phases to validate IBKR feasibility: account setup, API connectivity, basic order submission, WebSocket stability. |

### Medium Priority

| ID | Improvement | Impact | Description |
|---|---|---|---|
| BI-4 | Consider simpler MVP first | Faster time-to-user for validation | Intermediate simplified reference build: static portfolio allocation (no AI), manual rebalancing recommendations, paper trading display, single-page application, hard-coded Italian locale. Provides artifact for market validation and partner discussions. |
| TI-3 | ~~Modular monolith frontend~~ | ~~Superseded~~ | All 3 MFE remotes now implemented in Phase 4. See 04-frontend.md § 1.7. |
| TI-7 | Simplify orchestration (reduce Step Functions) | Less complexity | Keep Step Functions only for advisory-ctrl (complex multi-step with branching and human approval). Replace with Lambda orchestration for simpler workflows: execution-ctrl (sequential validate -> submit -> monitor), investor-ctrl (SQS-triggered notification), portfolio-ctrl (scheduled reconciliation). |
| TI-9 | ~~Zod for runtime validation~~ | ~~Moved to Phase 1~~ | See 01-foundation.md § 2.2 (platform-core consumer validation) |
| TI-10 | ~~Observability from day one~~ | ~~Moved to Phase 5~~ | See 05-testing-operations.md |
| AI-3 | Developer onboarding documentation (ADRs) | Future-proofing knowledge | Architecture Decision Records for all major decisions. Per-service guide (purpose, key patterns, deployment). Store in `/docs/adr/` in monorepo. |
| AI-4 | ~~Cost monitoring and budget alarms~~ | ~~Moved to Phase 1~~ | See 01-foundation.md § 3.7. Production adds per-service cost allocation tags. |

### Low Priority

| ID | Improvement | Impact | Description |
|---|---|---|---|
| TI-4 | REST before AppSync | Simpler prototype API layer | API Gateway + REST for BFF endpoints in early prototype phases. Introduce AppSync later for real-time features (portfolio subscriptions). Note: contradicts user's architectural choice; offered as honest assessment. |
| TI-5 | SST instead of raw CDK | Better developer experience | SST v3 (Ion) built on CDK v2: live Lambda development (hot reloading), built-in constructs, first-class monorepo support. Trade-off: additional framework dependency. Alternative: invest in shared `cdk-constructs` library. |
| TI-6 | Trunk-based development | Streamlined solo dev workflow | Trunk-based development on main. Short-lived feature branches only for multi-day changes. Automated deployment on merge to main (dev environment). Manual promotion to staging/production. Nx affected ensures only changed services deploy. |

---

*This document was compiled from the archived risk analysis (06), improvement suggestions (07), and consolidated plan review (09). It should be treated as the single source of truth for all post-prototype work.*
