# AG-UI Protocol Research

> Research date: 2026-03-19
> Sources: GitHub README, docs.ag-ui.com, SDK documentation, draft proposals

---

## 1. What is AG-UI Protocol?

AG-UI (Agent-User Interaction) is an **open, lightweight, event-based protocol** that standardizes how AI agents connect to user-facing applications. It sits alongside MCP and A2A in the "agentic protocol stack":

- **MCP** gives agents tools (server-side capabilities)
- **A2A** allows agents to communicate with other agents
- **AG-UI** brings agents into user-facing frontend applications

AG-UI was **born from CopilotKit's** partnership with LangGraph and CrewAI. It extracts CopilotKit's agent-interactivity infrastructure into an open protocol that any framework can adopt.

**Problem solved**: There is no standard way for AI agents to stream structured events (text, tool calls, state updates, reasoning) to frontend UIs. Each framework invents its own wire format. AG-UI standardizes ~16 event types so any agent backend can connect to any compatible frontend.

**License**: MIT (fully open source, 12.6k GitHub stars as of today).

---

## 2. Event Protocol (The Core)

### EventType Enum (~26 event types)

All events extend `BaseEvent { type: EventType; timestamp?: number; rawEvent?: any }`.

| Category | Events |
|---|---|
| **Lifecycle** | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED` |
| **Text Messages** | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK` |
| **Tool Calls** | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT` |
| **State Management** | `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT`, `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` |
| **Reasoning** | `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_MESSAGE_CHUNK`, `REASONING_END`, `REASONING_ENCRYPTED_VALUE` |

### Key Input Type

```typescript
type RunAgentInput = {
  threadId: string;
  runId: string;
  parentRunId?: string;
  state: any;
  messages: Message[];
  tools: Tool[];         // Frontend-defined tools (JSON Schema params)
  context: Context[];
  forwardedProps?: Record<string, any>;
  capabilities?: AgentCapabilities;
};
```

### State Management Pattern

Uses **snapshot-delta** pattern:
- `STATE_SNAPSHOT` — full state object sent initially or infrequently
- `STATE_DELTA` — incremental updates using **JSON Patch (RFC 6902)** operations
- `MESSAGES_SNAPSHOT` — full conversation history sync
- `ACTIVITY_SNAPSHOT/DELTA` — structured activity data (`{ messageId, activityType, content: Record<string, any> }`)

---

## 3. Structured UI Elements (Generative UI)

### Current State (Stable)

AG-UI handles structured UI through **two mechanisms**:

1. **Tool Calls**: The agent calls frontend-defined tools. The frontend maps tool names to UI components (e.g., `confirmAction` → confirmation dialog, `showChart` → chart widget). This is the **primary pattern today**.

2. **Activity Messages**: `ACTIVITY_SNAPSHOT` events carry `{ activityType: string, content: Record<string, any> }` — arbitrary structured payloads the frontend can render however it wants (cards, tables, progress indicators).

### Draft Proposal: Generative User Interfaces (NOT YET STABLE)

Status: **Draft** — under `/drafts/generative-ui`

Proposes a **two-step generation process**:
- **Step 1 (What)**: Agent decides what UI to generate (via tool call)
- **Step 2 (How)**: A pluggable "UI generator" (e.g., `UISchemaGenerator`, `ReactFormHookGenerator`) creates the actual UI definition

Use cases listed: dynamic forms, data visualization (charts/graphs/tables), interactive multi-step wizards, adaptive interfaces.

**Key limitation**: This is React-centric in the examples. The generators produce React-specific output (React Hook Form, etc.). There is no Angular generator yet.

**Bottom line for Nestfolio**: The stable path is tool-call-based UI. You define tools like `showRiskSlider`, `showOptionCards`, `showAllocationForm` on the frontend, register them in the `tools[]` array, and the agent calls them. The generative-UI draft is not production-ready.

---

## 4. Transport Layer

**AG-UI is transport-agnostic.** The protocol does not mandate a specific transport mechanism.

Supported transports:
- **SSE (Server-Sent Events)** — the reference/default implementation
- **WebSockets**
- **Webhooks**
- **Any custom transport**

The reference implementation ships an `HttpAgent` class that uses SSE over HTTP POST:
```
POST /agent → streams back SSE events
```

The middleware layer allows adapting non-standard event formats to AG-UI events regardless of transport.

---

## 5. LangGraph.js Integration

LangGraph is a **1st-party supported integration**:
- Status: **Supported** (not just community)
- Docs: `https://docs.copilotkit.ai/langgraph/`
- Demos: `https://dojo.ag-ui.com/langgraph-fastapi/feature/shared_state`

The integration works via the **integrations/** directory in the repo. LangGraph agents emit events that are mapped to AG-UI event types through middleware. The LangGraph integration supports:
- Shared state (LangGraph state ↔ AG-UI state snapshots/deltas)
- Tool calls (LangGraph tool nodes → AG-UI tool call events)
- Streaming text (LangGraph LLM streaming → AG-UI text message events)

**Important caveat**: The LangGraph integration docs live under `docs.copilotkit.ai`, not `docs.ag-ui.com`. This confirms the tight CopilotKit coupling — AG-UI's LangGraph integration is essentially CopilotKit's LangGraph integration extracted as a protocol.

**For Nestfolio (Bedrock AgentCore + LangGraph.js)**: You would need a custom integration. AG-UI does not have a Bedrock AgentCore adapter. You would:
1. Use `AbstractAgent` to implement a custom agent connector
2. Map your AgentCore/LangGraph events to AG-UI event types
3. Stream them over SSE or WebSockets to the frontend

---

## 6. Client-Side Libraries

### TypeScript SDK (npm packages)

| Package | Purpose |
|---|---|
| `@ag-ui/core` | Types, event definitions, enums — the protocol spec in code |
| `@ag-ui/client` | `AbstractAgent`, `HttpAgent`, middleware pipeline, `AgentSubscriber`, stream compaction |
| `@ag-ui/encoder` | Event serialization/deserialization (SSE format) |
| `@ag-ui/proto` | Protocol Buffers definitions |

### Python SDK

| Package | Purpose |
|---|---|
| `ag_ui.core` | Core types and events |
| `ag_ui.encoder` | Event encoding |

### Frontend Framework Support

| Client | Status | Notes |
|---|---|---|
| **CopilotKit (React)** | 1st Party | Full integration with hooks, components |
| **Terminal + Agent** | Community | CLI-based client |
| **React Native** | Help Wanted | Issue #510, not implemented yet |
| **Angular** | **NOT LISTED** | No official or community Angular client |

### Angular Assessment

**There is no Angular client for AG-UI.** The protocol is framework-agnostic at the event level (`@ag-ui/core` and `@ag-ui/client` are pure TypeScript), so you could consume events directly. But:
- No Angular-specific hooks/services/components exist
- No `@ag-ui/angular` package
- CopilotKit (the primary consumer) is React-only
- The generative UI draft specs reference React Hook Form, not Angular Reactive Forms
- You would need to build your own Angular adapter around `@ag-ui/client`

---

## 7. Relationship to CopilotKit

AG-UI is **created by and maintained by the CopilotKit team** (same GitHub org: `copilotkit`). Key evidence:

- README links to `copilotkit.ai` docs for integration guides
- The license badge links to `copilotkit/copilotkit` repo
- LangGraph/CrewAI docs are at `docs.copilotkit.ai`, not `docs.ag-ui.com`
- The Twitter/X handle is `@CopilotKit`
- Discord is shared with CopilotKit

**Relationship**: AG-UI is the **protocol layer extracted from CopilotKit**. CopilotKit is the **React UI framework** that implements AG-UI. Think of it as:
- AG-UI = wire protocol (events, types, transport)
- CopilotKit = React SDK that consumes AG-UI events and renders UI

If you are NOT using React, you get the protocol but lose all the CopilotKit UI components (chat panels, suggestion cards, etc.).

---

## 8. Architectural Assessment for Nestfolio

### Pros
- Clean event-based protocol with well-typed events
- Transport-agnostic (could work over AppSync subscriptions or SSE)
- State management via JSON Patch is elegant
- Tool-call pattern for structured UI is sensible
- MIT licensed, growing community (12.6k stars)

### Cons / Risks
- **No Angular support** — you would build everything from scratch
- **CopilotKit-centric** — the ecosystem assumes React; Angular is an afterthought at best
- **No Bedrock AgentCore integration** — custom work required
- **Generative UI is draft-only** — the structured-UI-beyond-tool-calls story is immature
- **Young protocol** — 1,274 commits but still has "draft proposals" for core features
- **LangGraph integration assumes Python FastAPI backend** — the demos/docs all show Python LangGraph, not LangGraph.js

### Recommendation

For Nestfolio's Angular + Bedrock AgentCore + LangGraph.js stack, AG-UI adds protocol overhead without delivering its key value (CopilotKit's React components). You would be:
1. Building a custom `AbstractAgent` for Bedrock AgentCore
2. Building a custom Angular client to consume AG-UI events
3. Building custom Angular components for all UI rendering

At that point, you are essentially implementing the protocol from scratch for both ends. The protocol types (`@ag-ui/core`) are useful as a reference for event design, but adopting AG-UI wholesale may not be justified unless you plan to support React frontends or integrate with CopilotKit in the future.

**Alternative**: Design your own AG-UI-inspired event protocol tailored to your AppSync/GraphQL transport, using the same event categories (lifecycle, text streaming, tool calls, state delta) but optimized for your Angular + AppSync stack.
