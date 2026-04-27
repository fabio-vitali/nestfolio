# Onboarding agent runtime — redesign

**Date:** 2026-04-28
**Branch:** `feat/playwright-e2e-ui`
**Status:** PROPOSAL — awaiting approval

## TL;DR

Replace `LangGraphAgent` from `@copilotkit/runtime/langgraph` with a small **in-process `AbstractAgent` subclass** that drives the existing local LangGraph and emits AG-UI events directly. No new infrastructure, no external dependency, ~120 LOC of contained event-translation. The `@copilotkit/runtime/langgraph` import goes away entirely; the onboarding service stops depending on a remote-LangGraph integration it never used.

This is the canonical AG-UI extension point — `Custom Agents` in the AG-UI docs literally show `class MyAgent extends AbstractAgent { run(input) { ... } }`. The existing `@ag-ui/langgraph` package implements this pattern itself, but for *remote* LangGraph deployments only.

## Problem (verified, not summarised)

After Bugs 1-3 (auth-token, CopilotKit 1.54 API drift, single-route protocol) were resolved, the AG-UI bridge from browser to AgentCore returns HTTP 200 `text/event-stream` whose first event is:

```
data: {"type":"RUN_ERROR","message":"Failed to retrieve assistant: fetch failed"}
```

### Why (verified by reading package source)

`server.ts` calls `new LangGraphAgent({ graph })`. The constructor in `@copilotkit/runtime/langgraph@1.54.0` (which re-exports `@ag-ui/langgraph@0.0.25`) is:

```ts
declare class LangGraphAgent extends AbstractAgent {
  constructor(config: LangGraphAgentConfig);  // requires deploymentUrl, optional langsmithApiKey
}
```

The `LangGraphAgentConfig` shape (verified in `node_modules/.pnpm/@ag-ui+langgraph@0.0.25.../dist/index.d.mts`):

```ts
interface LangGraphAgentConfig extends AgentConfig {
  client?: Client;                  // @langchain/langgraph-sdk
  deploymentUrl: string;            // REQUIRED
  langsmithApiKey?: string;
  graphId: string;                  // REQUIRED
  // ...
}
```

The `{ graph }` argument we pass is silently ignored — TypeScript only flags it because of structural compat. At runtime, the constructor builds a `Client` from `@langchain/langgraph-sdk` keyed off `apiUrl: e.deploymentUrl, apiKey: e.langsmithApiKey`. `runAgentStream()` calls `await this.getAssistant()` which fires `client.assistants.search()` — a remote `fetch()` against LangGraph Server / LangSmith Cloud. With no URL / key, the SDK defaults to LangSmith Cloud and fails: `Error: Failed to retrieve assistant: fetch failed`.

There is **no local-graph path** in `@ag-ui/langgraph@0.0.25`. The pre-1.54 `runtime.process(req, adapter)` shortcut that may have accepted a local graph is gone in 1.54.

### What's working underneath

- `agents/onboarding/graph.ts` builds a real `StateGraph` with `OnboardingAnnotation`, `routeToPhase` conditional edge, 7 phase nodes + safety cap, plus tools (`render_options`, `commit_phase`, `compute_risk`).
- `ChatBedrockConverse` wired with `us.anthropic.claude-sonnet-4-6` model id.
- `OnboardingRepository` wired with `TABLE_NAME` env var.
- AgentCore session id parsed from `x-amzn-bedrock-agentcore-runtime-session-id` header (`${tenantId}/${sessionId}`).
- `AgentTracer` + `EventBridgeTraceEmitter` wired to emit `ONBOARDING_AGENT_INVOCATION_TRACED` per run.
- Browser side (`onboarding-chat.component.ts`) is `@ag-ui/client.HttpAgent` posting raw `RunAgentInput` to `/api/copilotkit*`, CloudFront rewrites to `/runtimes/<arn>/invocations?qualifier=DEFAULT`.

Only the bridge between graph and AG-UI events is wrong.

## Recommendation: **In-process AG-UI server backed by an `AbstractAgent` subclass**

### Architecture

```
Browser HttpAgent
   ↓ POST /api/copilotkit (raw RunAgentInput)
CloudFront Function rewrites URI
   ↓ POST /runtimes/<arn>/invocations?qualifier=DEFAULT
AgentCore Runtime (Cognito JWT validated)
   ↓ POST :8080/invocations  (Hono)
OnboardingAgent (extends AbstractAgent)
   ↓ run(input: RunAgentInput): Observable<BaseEvent>
   ↓     calls graph.streamEvents({ messages, ...rehydrated state }, { version: 'v2' })
   ↓     translates LangGraph events → AG-UI BaseEvent stream
@ag-ui/encoder.EventEncoder.encodeSSE(event)
   ↓ Hono stream() helper writes SSE chunks
text/event-stream response
```

### Why this beats the alternatives

| Option | Verdict |
|---|---|
| **A. Custom `AbstractAgent`** (recommended) | In-process. No external deps. Symmetric with the 5 advisory agents (also in-process LangGraph in AgentCore containers). ~120 LOC of contained event mapping. Canonical per AG-UI docs. |
| B. Sidecar `langgraph-server` in container | Doubles the runtime footprint. Adds Python (or another Node process) + supervisor + port. Two failure modes per pod. Not idiomatic on AgentCore (one workload per container). Burns the bundle-size budget. |
| C. LangSmith Cloud | External dependency, recurring cost, network hop, investor data leaves AWS. Conflicts with the existing data-residency posture (everything else lives in `us-east-1`). And requires a LangSmith account billed separately. |
| D. Drop CopilotKit/AG-UI entirely; switch advisory pattern (request/response) | Loses streaming UX. The onboarding wizard's *whole point* is renderer-driven sequenced tool calls. Not viable. |

The **honest assessment** of the prior `@copilotkit/runtime` choice: it was a fit when the CopilotKit runtime accepted local LangGraphs in-process (pre-1.54). The 1.54 cut split `LangGraphAgent` into a remote-only client. Continuing to import from `@copilotkit/runtime/langgraph` for an *in-process* graph is a category error — that package is now exclusively a glue layer for *remote* LangGraph deployments. Removing the dependency clarifies the architecture.

### Code shape

#### New file: `services/investor/onboarding-bff/agents/onboarding/agent.ts`

```ts
import { AbstractAgent } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import type {
  BaseEvent,
  RunAgentInput,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
} from '@ag-ui/core';
import { Observable } from 'rxjs';
import type { CompiledStateGraph } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';

interface OnboardingAgentConfig {
  graph: CompiledStateGraph<any, any>;
  threadId?: string;
}

/**
 * Drives the in-process onboarding LangGraph and emits AG-UI events.
 *
 * AG-UI docs (concepts/agents) endorse subclassing `AbstractAgent` and
 * implementing `run(input)` as the canonical extension point. We use it to
 * bridge LangGraph's `streamEvents({ version: 'v2' })` output to the AG-UI
 * event stream that `@ag-ui/client.HttpAgent` consumes in the browser.
 */
export class OnboardingAgent extends AbstractAgent {
  constructor(private readonly config: OnboardingAgentConfig) {
    super({ threadId: config.threadId });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abort = new AbortController();
      this.runStream(input, subscriber, abort.signal).catch((err) => {
        subscriber.next({
          type: EventType.RUN_ERROR,
          message: err instanceof Error ? err.message : String(err),
        } as RunErrorEvent);
        subscriber.error(err);
      });
      return () => abort.abort();
    });
  }

  private async runStream(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    signal: AbortSignal,
  ): Promise<void> {
    subscriber.next({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as RunStartedEvent);

    // Last message is the new user input.
    const lastUser = input.messages[input.messages.length - 1];
    const initial = { messages: [new HumanMessage(lastUser?.content ?? '')] };

    const messageId = crypto.randomUUID();
    let textOpened = false;
    const toolCallsOpen = new Map<string, { name: string; argsBuf: string }>();

    for await (const ev of this.config.graph.streamEvents(initial, {
      version: 'v2',
      configurable: { thread_id: input.threadId },
      signal,
    })) {
      switch (ev.event) {
        case 'on_chat_model_stream': {
          const chunk = ev.data?.chunk;
          if (!chunk) break;
          // text deltas
          const text = typeof chunk.content === 'string' ? chunk.content : '';
          if (text) {
            if (!textOpened) {
              subscriber.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as TextMessageStartEvent);
              textOpened = true;
            }
            subscriber.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text } as TextMessageContentEvent);
          }
          // tool-call deltas (LangChain AIMessageChunk emits tool_call_chunks)
          for (const tc of chunk.tool_call_chunks ?? []) {
            const id = tc.id ?? '';
            if (!toolCallsOpen.has(id)) {
              toolCallsOpen.set(id, { name: tc.name ?? '', argsBuf: '' });
              subscriber.next({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: tc.name ?? '' } as ToolCallStartEvent);
            }
            const slot = toolCallsOpen.get(id)!;
            const argsDelta = tc.args ?? '';
            if (argsDelta) {
              slot.argsBuf += argsDelta;
              subscriber.next({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: argsDelta } as ToolCallArgsEvent);
            }
          }
          break;
        }
        case 'on_chat_model_end': {
          if (textOpened) {
            subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent);
            textOpened = false;
          }
          for (const [id] of toolCallsOpen) {
            subscriber.next({ type: EventType.TOOL_CALL_END, toolCallId: id } as ToolCallEndEvent);
          }
          toolCallsOpen.clear();
          break;
        }
        // tool nodes execute server-side; render tools just stringify input,
        // commit_phase / compute_risk run real logic; their results land back
        // as tool messages on the next iteration. We don't surface those as
        // AG-UI tool events — they're already represented by the chat-model
        // tool_call_chunks above.
      }
    }

    subscriber.next({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as RunFinishedEvent);
    subscriber.complete();
  }
}
```

#### Replace: `services/investor/onboarding-bff/agents/onboarding/server.ts`

The `/invocations` handler becomes:

```ts
const input = (await c.req.json()) as RunAgentInput;
const tracer = new AgentTracer();
const graph = buildOnboardingGraph({ repo }, { tracer });
const agent = new OnboardingAgent({ graph, threadId: input.threadId });
const encoder = new EventEncoder({ accept: c.req.header('accept') });

c.header('Content-Type', encoder.getContentType());
c.header('Cache-Control', 'no-cache, no-transform');
c.header('X-Accel-Buffering', 'no');

return stream(c, async (sseStream) => {
  await new Promise<void>((resolve, reject) => {
    const sub = agent.run(input).subscribe({
      next: (ev) => void sseStream.write(encoder.encodeSSE(ev)),
      error: reject,
      complete: resolve,
    });
    sseStream.onAbort(() => sub.unsubscribe());
  });
});
```

#### Drop: dependency on `@copilotkit/runtime/langgraph`

The only remaining `@copilotkit/runtime` import in the onboarding bundle was `LangGraphAgent`. Once removed, the entire `@copilotkit/runtime` package can leave the agent bundle (the *frontend* still imports `@copilotkitnext/angular`, which is a different package). Bundle ≤ 4 MB expected — esbuild will tree-shake the rest.

#### Unchanged

- `graph.ts` — already correct, already streams events
- `state.ts`, `router.ts`, `phase-node.ts`, `session.ts`, `tools/*.ts` — untouched
- `libs/cdk-constructs/src/extensions/agent-runtime.ts` — no infra changes; container shape, port 8080, Cognito JWT auth, IAM grants all stay
- `service.stack.ts` CloudFront `/api/copilotkit*` rewrite — unchanged
- `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts` — unchanged

### Migration plan (commits)

1. `feat(onboarding-bff): in-process AG-UI agent over local LangGraph` — add `agent.ts`, simplify `server.ts`, drop `LangGraphAgent` import.
2. `chore(onboarding-bff): drop @copilotkit/runtime from agent bundle` — remove the import + verify build-agent emits a smaller bundle.
3. `test(onboarding-bff): unit tests for OnboardingAgent event translation` — Jest suite under `services/investor/onboarding-bff/test/unit/agent.spec.ts`.
4. (After deploy verifies clean) iteration commits on the e2e journey if needed.

### Test plan

**Unit (new):** `test/unit/agent.spec.ts`
- Build a tiny mock graph that yields a fixed sequence of `streamEvents` outputs and assert the AG-UI event order:
  - text-only message → `RUN_STARTED`, `TEXT_MESSAGE_START`, ≥1 `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `RUN_FINISHED`
  - tool call → `RUN_STARTED`, `TOOL_CALL_START`, ≥1 `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `RUN_FINISHED`
  - thrown error → `RUN_ERROR` followed by Observable error
- Assert `messageId` is stable within a single message and changes between messages
- Assert tool-call ids round-trip from chunks to AG-UI events

**Existing tests retired:** none. The previous server.ts had no unit tests for the bridge.

**Integration:** the existing `test-integration` target runs against mocked AgentCore — the new agent class is exercised by the onboarding integration suite without changes.

**E2E (the actual acceptance bar):** `pnpm nx run nestfolio-e2e:e2e` → `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`. The journey now reaches step 2 → `render_options` renderer mounts → user click advances → step 3 etc. Phase 10 acceptance unblocked.

### Risk register

| Risk | Likelihood | Mitigation / rollback |
|---|---|---|
| LangGraph `streamEvents v2` shape differs from what I documented (LangChain JS API drift) | Med | Unit test asserts the actual chunk shape; if surprised, fix the mapping. Rollback = revert to current 96f47155 broken state (no regression — current state already broken). |
| Tool-call chunks don't carry `id` until `on_chat_model_end` (some providers stream args without an id mid-stream) | Med | Buffer args until id appears; emit `TOOL_CALL_START` lazily on first id. The Bedrock `ChatBedrockConverse` adapter reliably emits `tool_call_chunks[].id` per LangChain JS source — check during smoke. |
| AG-UI `EventType` enum names differ from the strings the browser parser expects | Low | The browser uses the same `@ag-ui/client` package — same enum source. |
| Bundle build breaks on missing `@ag-ui/core` types | Low | Already a transitive of `@ag-ui/client`; add direct dep if needed. |
| AgentCore Runtime container-restart on each invocation loses thread state | Low | The graph is stateless across invocations; user state lives in DynamoDB via `OnboardingRepository`. `threadId` from `RunAgentInput` is the LangGraph `configurable.thread_id` — stateless graphs ignore it. No regression vs. current. |
| Streaming events back-pressure | Low | `Hono` `stream()` has its own back-pressure; `subscriber.next()` is synchronous on Observable. Match upstream advisory pattern. |

**Rollback:** single revert of the migration commit. Bundle artifact is built per-deploy, no migration of state.

### Out of scope

- Re-architecting the 5 advisory (batch) agents
- Adding a streaming variant of `invokeAgentCoreRuntime` to `libs/agent-orchestrator` (the user said `invoke-agentcore-streaming.ts` is a future placeholder; not needed because the browser → AgentCore path doesn't go through the orchestrator)
- Frontend changes (the AG-UI client stays as-is)

## After deploy: handoff to Playwright e2e

Per the user's brief:
1. Kill any stale dev servers on 4200-4205.
2. `NESTFOLIO_INTEG_PREFIX=dev AWS_REGION=us-east-1 pnpm nx run nestfolio-e2e:e2e`
3. Iterate if subsequent journey steps fail (1-2 iterations expected for state propagation).
4. Phase 10 acceptance: boot-time budget + 10-run stability.
5. Update memory + commit (no PR).
