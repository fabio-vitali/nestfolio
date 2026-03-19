# Conversational Onboarding Agent — Design Spec

**Date**: 2026-03-19
**Status**: Draft
**Domain**: Investor
**Service**: `onboarding-agent-bff` (new)

## Overview

Replace the existing 6-step stepper wizard in `investor-mfe` with a fully dynamic conversational agent powered by AWS Bedrock AgentCore, LangGraph.js, and CopilotKit. The UX matches the demo at `demo/index.html` — a chat interface where the Nestfolio agent guides the user through onboarding via natural dialogue with rich UI components (choice cards, sliders, amount inputs, summary cards, consent flows).

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent intelligence | Fully dynamic (LLM-generated responses) | Natural conversation, handles free-text, adapts tone |
| Goal scope | Single primary goal per session | Aligns with existing data model, keeps flow focused |
| Data collected | Demo data set (goal, horizon, sim/live, capital, risk, operating mode, mandate) | Adds AccountMode + capital fields to schema |
| Stepper replacement | Replace entirely | One onboarding experience, no dead code |
| Runtime | AgentCore Runtime + CopilotKit (SSE) | Real-time streaming, stateful sessions |
| UI protocol | CopilotKit + AG-UI Protocol | Open-source, Generative UI, Angular support via `@copilotkitnext/angular` |
| Progress UX | Phase-based (7 phases) | Agent reports current phase; variable turns per phase allowed |
| Risk profiling | Inline deterministic scoring | Cards preferred, free-text mapped to categories with confirmation |
| Persistence | Per-phase commit to DynamoDB | Partial progress saved; resume from last completed phase |
| Service location | New `onboarding-agent-bff` | Dedicated service, clean separation from investor-bff |
| Old mutations | Remove from investor-bff | onboarding-agent-bff owns entire flow |
| Documentation RAG | Bedrock Knowledge Base + S3 | Agent answers product questions mid-conversation |

### Angular Compatibility Note

`@copilotkitnext/angular` declares `@angular/core: ^19.0.0` peer dependency. Project uses Angular 21. Mitigation: install with `pnpm.overrides` for the peer dep. If runtime issues arise, fallback to Approach B (AG-UI protocol + custom Angular chat components) — same backend, only frontend changes.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│  investor-mfe (Angular 21)                      │
│  ┌───────────────────────────────────────────┐  │
│  │  @copilotkitnext/angular                  │  │
│  │  CopilotChat component + custom renderers │  │
│  │  AG-UI client (SSE transport)             │  │
│  └────────────────┬──────────────────────────┘  │
└───────────────────┼─────────────────────────────┘
                    │ AG-UI events (SSE)
┌───────────────────┼─────────────────────────────┐
│  onboarding-agent-bff (new service)             │
│  AgentRuntime container + CopilotKit Runtime    │
│  ┌────────────────┴──────────────────────────┐  │
│  │  LangGraph.js StateGraph                  │  │
│  │  7 phase nodes + tools                    │  │
│  │  Bedrock Claude Sonnet                    │  │
│  └────────────────┬──────────────────────────┘  │
│                   │ Tool calls                   │
│  ┌────────────────┴──────────────────────────┐  │
│  │  DynamoDB persistence tools               │  │
│  │  (same table as investor-bff)             │  │
│  ├───────────────────────────────────────────┤  │
│  │  Bedrock Knowledge Base (RAG)             │  │
│  │  Nestfolio product documentation          │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                    │ DDB Streams CDC
                    ▼
          EventBridge (investor-hub)
```

- CopilotKit Runtime runs inside the AgentRuntime container (Hono HTTP server)
- Agent uses Claude Sonnet for conversation (fast enough for real-time, smart enough for Italian fluency)
- Phase persistence writes directly to DynamoDB using investor-bff's table and key schema
- Domain events (GOAL_SET, RISK_PROFILE_SET, MANDATE_GRANTED, etc.) fire via DDB Streams CDC — downstream services unchanged
- Bedrock Knowledge Base provides RAG for product documentation questions

---

## 2. LangGraph Agent Design

### State Graph

```
                    ┌─────────┐
                    │  START   │
                    └────┬─────┘
                         ▼
                    ┌─────────┐
                 ┌──│ Router  │──┐
                 │  └─────────┘  │ (routes to current phase)
                 ▼       ▼       ▼
           ┌──────┐ ┌────────┐ ┌──────────┐
           │ Goal │ │Horizon │ │   Mode   │ ...7 phase nodes
           └──┬───┘ └───┬────┘ └────┬─────┘
              │         │           │
              ▼         ▼           ▼
         ┌─────────────────────────────┐
         │  Phase Commit (tool call)   │
         │  persist → advance phase    │
         └──────────────┬──────────────┘
                        ▼
                   ┌─────────┐
                   │ Router  │ (loop back for next phase)
                   └────┬────┘
                        ▼
                  ┌───────────┐
                  │ Complete  │ (after mandate accepted)
                  └───────────┘
```

### Agent State Schema

Shared between agent and frontend via CopilotKit CoAgent state sync:

```typescript
interface OnboardingState {
  phase: 'goal' | 'horizon' | 'mode' | 'capital' | 'risk' | 'operating_mode' | 'mandate';
  phaseIndex: number;        // 0-6, drives progress bar
  totalPhases: number;       // 7

  // Collected data (populated progressively)
  goal?: string;             // e.g. "Far crescere il capitale"
  horizonYears?: number;     // 1-30
  accountMode?: 'simulation' | 'live';
  capitalAmount?: number;    // e.g. 10000
  riskProfile?: {
    tolerance: string;       // mapped from card selection
    experienceLevel: string; // mapped from card selection
    score: number;           // 0-100, deterministic
    category: 'conservative' | 'moderate' | 'aggressive';
  };
  operatingMode?: 'conservative' | 'balanced' | 'aggressive';
  mandateAccepted?: boolean;

  messages: BaseMessage[];   // LangGraph conversation history
}
```

### 7 Phase Nodes

Each node:
1. Receives current state + conversation history
2. Has a phase-specific system prompt (Italian, friendly Nestfolio persona)
3. Uses Generative UI tool calls to render rich components
4. Extracts structured data from user responses (card selection or free-text)
5. Calls `commit_phase` tool on phase completion
6. Advances `phase` and `phaseIndex` in state

### Agent Tools

| Tool | Purpose | When |
|------|---------|------|
| `render_options` | Show emoji choice cards | Goal, risk tolerance, experience phases |
| `render_mode_cards` | Show large cards with badge + details | Sim/live mode, operating mode phases |
| `render_slider` | Show range slider (1-30 years) | Horizon phase |
| `render_amount` | Show currency input + preset buttons | Capital phase |
| `render_summary` | Show recap card (label-value rows) | Mandate review + completion |
| `render_consent` | Show checkbox + legal links | Mandate phase |
| `render_cta` | Show action button | Completion (→ dashboard) |
| `commit_phase` | Persist phase data to DynamoDB | After each phase completes |
| `compute_risk_profile` | Deterministic risk score from categories | After risk conversation |
| `search_knowledge_base` | RAG query against Nestfolio docs | When user asks off-topic questions |

### Risk Profiling

Deterministic, not LLM-scored:

- Agent renders `render_options` for two risk questions (same options as demo)
- If user taps a card → direct mapping to category
- If user types free text → agent interprets and confirms ("Sembra che tu non faresti nulla e aspetteresti. Confermi?") → then maps to card category
- `compute_risk_profile` tool: pure function `(riskResponse: 0-3, experienceLevel: 0-3) → { score, category }`
- No LLM involved in the scoring itself

### Model Choice

Claude Sonnet for all conversation nodes — ~1-2s latency, good Italian fluency, cost-effective for real-time chat. `withRetry` escalation to Opus on failure.

---

## 3. Frontend Integration

### investor-mfe Changes

Replace the stepper with a single chat screen:

```
apps/investor-mfe/src/app/
├── onboarding/
│   ├── onboarding-chat.component.ts    ← NEW (replaces onboarding-container)
│   ├── renderers/                       ← NEW (Generative UI components)
│   │   ├── options-renderer.component.ts
│   │   ├── mode-cards-renderer.component.ts
│   │   ├── slider-renderer.component.ts
│   │   ├── amount-renderer.component.ts
│   │   ├── summary-renderer.component.ts
│   │   ├── consent-renderer.component.ts
│   │   └── cta-renderer.component.ts
│   └── steps/                           ← DELETE (old stepper components)
├── stores/
│   └── onboarding.store.ts             ← SIMPLIFY (state now in CoAgent)
├── services/
│   └── onboarding.service.ts           ← DELETE (mutations handled by agent tools)
```

### CopilotKit Wiring

```typescript
// onboarding-chat.component.ts
@Component({
  template: `
    <div class="chat-screen">
      <header class="agent-header">
        <div class="agent-avatar">N</div>
        <div>
          <div class="agent-name">Nestfolio</div>
          <div class="agent-status">Attivo ora</div>
        </div>
      </header>
      <div class="progress-bar">
        <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        <span>{{ phaseIndex() + 1 }} di {{ totalPhases() }}</span>
      </div>
      <copilot-chat
        [agentName]="'onboarding-agent'"
        [renderers]="customRenderers"
        [labels]="chatLabels"
      />
    </div>
  `
})
```

### Generative UI Renderers

Each maps to an agent tool call. When the agent calls a render tool, CopilotKit renders the corresponding Angular component:

| Agent tool call | Renderer component | Demo equivalent |
|---|---|---|
| `render_options` | `OptionsRendererComponent` | Emoji choice cards (goal, risk, experience) |
| `render_mode_cards` | `ModeCardsRendererComponent` | Large cards with badge + details list |
| `render_slider` | `SliderRendererComponent` | Range slider (1-30 years) |
| `render_amount` | `AmountRendererComponent` | Currency input + preset buttons |
| `render_summary` | `SummaryRendererComponent` | Read-only recap card (mandate, final plan) |
| `render_consent` | `ConsentRendererComponent` | Checkbox + legal links |
| `render_cta` | `CtaRendererComponent` | Action button ("Vai alla Dashboard") |

### Shared State Sync

CopilotKit's CoAgent pattern syncs `OnboardingState` between agent and frontend via AG-UI state events. The progress bar reads `phaseIndex` / `totalPhases` directly from the shared state.

### Styling

Renderers reuse the demo's CSS: chat bubbles with fade-in animations, card grids, typing indicator, full-height flex column layout with scrollable chat area. Agent messages left-aligned with avatar, user messages right-aligned.

---

## 4. Backend — onboarding-agent-bff Service

### Service Structure

```
services/investor/onboarding-agent-bff/
├── src/
│   ├── agent/
│   │   ├── graph.ts                 ← LangGraph StateGraph definition
│   │   ├── state.ts                 ← OnboardingState schema (Zod)
│   │   ├── phases/
│   │   │   ├── goal.ts              ← Goal phase node
│   │   │   ├── horizon.ts
│   │   │   ├── mode.ts
│   │   │   ├── capital.ts
│   │   │   ├── risk.ts
│   │   │   ├── operating-mode.ts
│   │   │   └── mandate.ts
│   │   ├── tools/
│   │   │   ├── render-ui.ts         ← Generative UI tool definitions
│   │   │   ├── commit-phase.ts      ← DynamoDB persistence per phase
│   │   │   ├── compute-risk.ts      ← Deterministic risk scoring function
│   │   │   └── search-kb.ts         ← RAG: query Bedrock Knowledge Base
│   │   ├── prompts/
│   │   │   ├── system.ts            ← Base system prompt (Italian, Nestfolio persona)
│   │   │   └── phase-instructions.ts ← Per-phase instructions
│   │   └── router.ts               ← Conditional edge: routes to current phase node
│   ├── runtime/
│   │   └── server.ts               ← CopilotKit Runtime on Hono + LangGraph adapter
│   ├── repositories/
│   │   └── onboarding.repository.ts ← DynamoDB writes (same table as investor-bff)
│   ├── service-domain/
│   │   ├── events.ts               ← ONBOARDING_STARTED, ONBOARDING_COMPLETED
│   │   └── schemas.ts              ← Zod schemas for persisted data
│   ├── service.stack.ts            ← CDK stack
│   └── project.json
├── test/
│   ├── agent/
│   │   ├── graph.test.ts
│   │   ├── phases/*.test.ts
│   │   └── tools/*.test.ts
│   └── runtime/
│       └── server.test.ts
```

### CopilotKit Runtime

```typescript
// runtime/server.ts
import { CopilotRuntime, LangGraphAdapter } from '@copilotkit/runtime';
import { Hono } from 'hono';
import { onboardingGraph } from '../agent/graph';

const app = new Hono();

app.post('/copilotkit', async (c) => {
  const runtime = new CopilotRuntime();
  const adapter = new LangGraphAdapter({ graph: onboardingGraph });
  return runtime.process(c.req.raw, adapter);
});
```

### CDK Stack

```typescript
// service.stack.ts
const knowledgeBase = new KnowledgeBase(this, 'OnboardingKB', {
  kbName: 'nestfolio-docs',
  description: 'Nestfolio product documentation for onboarding agent',
});

new AgentRuntime(this, 'OnboardingAgent', {
  runtimeName: 'onboarding-agent',
  agentCodePath: path.join(__dirname, '../agent'),
  userPool,
  tables: [investorTable],
  modelIds: [SONNET_MODEL_ARN],
  toolTargets: [{
    name: 'search_knowledge_base',
    description: 'Search Nestfolio documentation to answer user questions',
    handler: 'tools/search-kb.handler',
    schemaPath: 'tools/search-kb.schema.json',
  }],
  environmentVariables: {
    TABLE_NAME: investorTable.tableName,
    KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
  },
});
```

---

## 5. Data Model Changes

### Existing Records (kept, some extended)

| SK Pattern | Change | Details |
|---|---|---|
| `InvestorProfile` | No change | Profile header, created on USER_REGISTERED |
| `Goal#{goalId}` | Add field | `horizonYears: number` (1-30, from slider) |
| `RiskProfile#{profileId}` | Add fields | `toleranceResponse: string`, `experienceLevel: string` |
| `Mandate#{mandateId}` | No change | Already complete |
| `OperatingMode#{id}` | No change | Already complete |
| `EditEvent#{ts}#{uuid}` | No change | Audit trail |

### New Records

```typescript
// AccountMode — sim/live mode + capital
{
  pk: 'InvestorProfile#{tenantId}#{userId}',
  sk: 'AccountMode',
  mode: 'simulation' | 'live',
  capitalAmount: number,
  currency: 'EUR',
  createdAt: string,
  updatedAt: string,
}

// OnboardingSession — tracks resumable conversation state
{
  pk: 'InvestorProfile#{tenantId}#{userId}',
  sk: 'OnboardingSession#{sessionId}',
  currentPhase: 'goal' | 'horizon' | 'mode' | 'capital' | 'risk' | 'operating_mode' | 'mandate' | 'completed',
  phaseIndex: number,
  startedAt: string,
  completedAt?: string,
  agentMemorySessionId: string,  // pointer to AgentCore Memory session
  ttl: number,                   // auto-expire incomplete sessions after 7 days
}
```

### Phase Persistence Mapping

| Phase | DDB Write | SK Pattern |
|---|---|---|
| goal | Goal record + EditEvent | `Goal#{goalId}` |
| horizon | Update Goal with horizonYears | `Goal#{goalId}` |
| mode | AccountMode record + EditEvent | `AccountMode` |
| capital | Update AccountMode with amount | `AccountMode` |
| risk | RiskProfile record + EditEvent | `RiskProfile#{profileId}` |
| operating_mode | OperatingMode record + EditEvent | `OperatingMode#{id}` |
| mandate | Mandate record + EditEvent | `Mandate#{mandateId}` |

### Domain Events

Two new events from onboarding-agent-bff:

| Event | Trigger | Payload |
|---|---|---|
| `ONBOARDING_STARTED` | First phase committed | `{ tenantId, userId, sessionId, accountMode }` |
| `ONBOARDING_COMPLETED` | Mandate accepted | `{ tenantId, userId, sessionId, riskCategory, operatingMode, goal }` |

Existing events (`GOAL_SET`, `RISK_PROFILE_SET`, `MANDATE_GRANTED`, etc.) continue to fire via DDB Streams CDC — no downstream changes needed.

### Migration

No data migration needed. New fields are additive. Existing profiles without `AccountMode` or `OnboardingSession` records remain valid.

---

## 6. Session Resume & Error Handling

### Session Lifecycle

```
User opens /investor/onboarding
         │
         ▼
  Query OnboardingSession for user
         │
    ┌────┴─────┐
    │ Exists?  │
    ├─ No ─────┼──► Create new session → Start agent from phase 0 (goal)
    │          │
    ├─ Yes,    ┼──► Rehydrate state from last committed phase
    │ active   │    Load conversation from AgentCore Memory
    │          │    Agent: "Bentornato! Eravamo rimasti a..."
    │          │
    └─ Yes,    ┴──► Show recap + CTA to dashboard
      completed
```

### Resume Mechanics

- `OnboardingSession` stores `currentPhase` + `agentMemorySessionId`
- On resume, LangGraph state rebuilt from committed DDB records (DDB is source of truth for structured data, Memory is for conversation context/tone)
- Agent picks up naturally, acknowledging collected data
- TTL of 7 days on incomplete sessions — after that, user starts fresh

### Error Handling

| Failure | Behavior |
|---|---|
| Agent response timeout (>15s) | "Un momento..." indicator, retry once. If still failing, "Qualcosa è andato storto. Riprova." with retry button |
| DDB commit fails | Agent retries `commit_phase` (LangGraph built-in retry). If persistent, tells user and suggests retry |
| Invalid agent state | Zod validation catches it. Agent re-asks current phase question |
| User sends gibberish | Agent redirects: "Non ho capito, potresti ripetere?" and re-presents options |
| SSE disconnect | Frontend auto-reconnects. Agent resumes from last committed phase |
| Model invocation error | `withRetry` escalation (Sonnet → Opus). If both fail, static fallback message |

### Guardrails

- Agent stays on-topic (onboarding only, no general chat beyond documentation questions)
- Agent never gives financial advice during onboarding (only collects preferences)
- Agent always confirms before committing a phase ("Ho capito bene: il tuo obiettivo è far crescere il capitale. Confermi?")
- Italian language enforced in system prompt
- Max conversation length: 50 turns (safety cap — normal flow is ~15-20 turns)

### RAG — Nestfolio Documentation

Knowledge base for answering product questions mid-conversation:

```
docs/knowledge-base/
├── product-overview.md     ← What is Nestfolio, how it works
├── fees-and-pricing.md     ← Fee structure, commissions
├── faq.md                  ← Common questions
├── risk-disclaimer.md      ← Risk warnings, regulatory info
├── operating-modes.md      ← Conservative/Balanced/Aggressive explained
├── simulation-mode.md      ← How simulation works, limitations
└── mandate-terms.md        ← What the mandate authorizes
```

- Indexed into Bedrock Knowledge Base via `KnowledgeBase` CDK construct (S3 + Titan Embed v2)
- Agent calls `search_knowledge_base` tool when user asks off-topic questions
- Agent answers conversationally in Italian, then steers back: "Ottima domanda! [answer]. Torniamo a noi — stavamo parlando di..."

---

## 7. Testing Strategy

### Unit Tests

| Area | What's tested | Approach |
|---|---|---|
| Phase nodes | Correct state transitions per phase | Mock LLM responses, assert state changes |
| `compute_risk` | Deterministic scoring matrix | Pure function, all input combinations |
| `commit_phase` | Correct DDB params per phase | Mock DDB client, verify TransactWrite items |
| `search_knowledge_base` | Query formatting + response parsing | Mock Bedrock RetrieveAndGenerate |
| Router | Routes to correct phase based on state | Assert conditional edges |
| Zod schemas | OnboardingState validation | Valid + invalid inputs |
| Angular renderers | Correct DOM output for input props | Angular TestBed, no CopilotKit runtime |

### Integration Tests

| Test | Verifies |
|---|---|
| Full happy path | All 7 phases complete, state populated, all DDB commits fired |
| Resume from phase 3 | Rehydrate state, agent continues from capital phase |
| Free-text risk mapping | "I'd hold and wait" → maps to 'hold' category, confirms |
| Off-topic question mid-flow | Asks about fees → RAG tool called → resumes current phase |
| Gibberish input | Agent re-prompts with current phase options |
| Max turns safety cap | After 50 turns, agent closes gracefully |

### E2E Tests (optional)

- Full onboarding conversation against deployed agent
- Verify DDB records match expected state after completion
- Verify domain events published via DDB Streams

### Test Location

`services/investor/onboarding-agent-bff/test/` following project convention (`test/` directory, not `src/__tests__/`).

---

## 8. Removal from investor-bff

The following are removed from `investor-bff` once onboarding-agent-bff is deployed:

### GraphQL Schema

Remove mutations: `recordOnboardingAnswer`, `setGoal`, `setRiskProfile`, `selectOperatingMode`, `grantMandate`

### JS Resolvers

Delete: `record-onboarding-answer.fn.js`, `set-goal.fn.js`, `set-risk-profile.fn.js`, `select-operating-mode.fn.js`, `grant-mandate.fn.js`

### Validation Schemas

Remove onboarding-related Zod schemas from `src/validation/schemas.ts`

### Facade Construct

Remove the deleted resolvers from the Facade `jsResolvers[]` configuration.

**Retained in investor-bff**: `getProfile`, `getGoals`, `getNotifications`, `getUnreadCount` queries + notification/balance event pipes + deposit/withdrawal mutations.

---

## Dependencies & Packages

### New npm packages

| Package | Purpose | Scope |
|---|---|---|
| `@copilotkitnext/angular` | Angular chat UI + Generative UI | investor-mfe |
| `@ag-ui/client` | AG-UI protocol client | investor-mfe |
| `@ag-ui/core` | AG-UI event types | shared |
| `@copilotkit/runtime` | CopilotKit backend runtime | onboarding-agent-bff |
| `@ag-ui/langgraph` | LangGraph ↔ AG-UI adapter | onboarding-agent-bff |
| `hono` | Lightweight HTTP server for CopilotKit | onboarding-agent-bff |

### Existing packages (already in workspace)

- `@langchain/langgraph` — state graph
- `@langchain/aws` — Bedrock adapter
- `@aws-sdk/client-dynamodb` — DDB persistence
- `@aws-sdk/client-bedrock-agent-runtime` — Knowledge Base retrieval
- `zod` — state/schema validation

### pnpm.overrides

```json
{
  "@copilotkitnext/angular>@angular/core": "21.x",
  "@copilotkitnext/angular>@angular/common": "21.x",
  "@copilotkitnext/angular>@angular/cdk": "21.x"
}
```

---

## Fallback Plan

If `@copilotkitnext/angular` proves incompatible with Angular 21 at runtime:

1. Keep the entire backend (onboarding-agent-bff, LangGraph graph, CopilotKit Runtime) unchanged
2. Replace `@copilotkitnext/angular` with `@ag-ui/client` (framework-agnostic)
3. Build custom Angular chat components consuming AG-UI events directly
4. Same protocol, same renderers, just wired manually instead of via CopilotKit's Angular bindings

Backend changes: zero. Frontend: replace one component (`copilot-chat`) with a custom `onboarding-chat` that subscribes to AG-UI event stream.
