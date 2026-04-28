import { AbstractAgent, EventType } from '@ag-ui/client';
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
  StateSnapshotEvent,
} from '@ag-ui/client';
import { Observable, type Subscriber } from 'rxjs';
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';

interface StreamableGraph {
  streamEvents(
    input: unknown,
    options: {
      version: 'v1' | 'v2';
      configurable?: Record<string, unknown>;
      signal?: AbortSignal;
      callbacks?: unknown[];
    },
  ): AsyncIterable<LangGraphStreamEvent>;
}

interface LangGraphStreamEvent {
  event: string;
  name?: string;
  run_id?: string;
  parent_ids?: string[];
  metadata?: Record<string, unknown>;
  data?: {
    chunk?: ChunkLike;
    input?: unknown;
    output?: (ChunkLike & Record<string, unknown>) | string;
  };
}

interface LangChainCallbackHandler {
  handleChainStart?: (chain: unknown, inputs: unknown, runId: string, parentRunId?: string) => void;
  handleChainEnd?: (outputs: unknown, runId: string) => void;
  handleLLMStart?: (
    llm: unknown,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
  ) => void;
  handleLLMEnd?: (output: unknown, runId: string) => void;
  handleToolStart?: (tool: unknown, input: string, runId: string, parentRunId?: string) => void;
  handleToolEnd?: (output: string, runId: string) => void;
  handleToolError?: (err: Error, runId: string) => void;
}

const STATE_SNAPSHOT_KEYS = [
  'phase',
  'phaseIndex',
  'totalPhases',
  'goal',
  'operatingMode',
  'horizonYears',
  'capitalAmount',
  'mandateAccepted',
] as const;

interface ChunkLike {
  content?: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
  tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }>;
}

interface OnboardingAgentConfig {
  graph: StreamableGraph;
  threadId?: string;
  /**
   * LangChain BaseCallbackHandler instances to pass through `streamEvents`
   * config. Used to wire the AgentTracer so handleToolStart / handleToolEnd
   * fire on tool invocations inside the graph (the tracer relies on these
   * callbacks to populate the AgentTraceEnvelope.toolCalls list).
   */
  callbacks?: unknown[];
}

/**
 * AG-UI agent that drives the in-process onboarding LangGraph.
 *
 * Translates LangGraph's `streamEvents` (v2) output into the AG-UI event
 * stream that `@ag-ui/client.HttpAgent` consumes in the browser.
 *
 * Tool-call handling: Bedrock Converse streams `tool_call_chunks` with
 * `index` set but `id` + `name` undefined on every delta. The full call (with
 * id/name and concatenated args) only appears on the AIMessage emitted by
 * `on_chat_model_end`. We therefore:
 *   - stream text deltas as TEXT_MESSAGE_CONTENT
 *   - skip tool_call_chunks during streaming
 *   - on `on_chat_model_end`, read `output.tool_calls` and emit a complete
 *     TOOL_CALL_START + TOOL_CALL_ARGS + TOOL_CALL_END burst per tool call.
 *
 * Renderers don't show progressive args, so the lack of streaming on tool
 * calls is acceptable.
 */
export class OnboardingAgent extends AbstractAgent {
  constructor(private readonly cfg: OnboardingAgentConfig) {
    super({ threadId: cfg.threadId });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abort = new AbortController();
      this.runStream(input, subscriber, abort.signal).then(
        () => subscriber.complete(),
        (err) => {
          const message = err instanceof Error ? err.message : String(err);
          subscriber.next({ type: EventType.RUN_ERROR, message } as RunErrorEvent);
          subscriber.error(err);
        },
      );
      return () => abort.abort();
    });
  }

  private async runStream(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    signal: AbortSignal,
  ): Promise<void> {
    subscriber.next({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    } as RunStartedEvent);

    const eventCounts: Record<string, number> = {};
    const recordEvent = (type: string) => {
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;
    };

    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    // Bedrock Converse rejects empty `human` content. Browser sends
    // `messages: []` on first run (see onboarding-chat.component.ts ngOnInit);
    // a neutral kickoff lets the model run with the system prompt + phase
    // instructions driving the response.
    const userText = (lastUser?.content ?? '').trim() || 'Iniziamo.';

    const initial: Record<string, unknown> = {
      ...(input.state as Record<string, unknown> | undefined),
      messages: [new HumanMessage(userText)],
    };

    const messageId = randomUUID();
    let textOpened = false;
    let toolCallsEmitted = 0;
    let finalState: Record<string, unknown> | undefined;

    const callbacks = (this.cfg.callbacks ?? []) as LangChainCallbackHandler[];
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'OnboardingAgent runStream init',
      callbacksCount: callbacks.length,
      hasHandleToolStart: callbacks.length > 0 && typeof callbacks[0].handleToolStart === 'function',
      hasHandleLLMStart: callbacks.length > 0 && typeof callbacks[0].handleLLMStart === 'function',
    }));

    for await (const ev of this.cfg.graph.streamEvents(initial, {
      version: 'v2',
      configurable: { thread_id: input.threadId },
      signal,
      callbacks: this.cfg.callbacks,
    })) {
      recordEvent(`graph:${ev.event}`);
      if (ev.event === 'on_chat_model_start' || ev.event === 'on_tool_start' || ev.event === 'on_tool_end') {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'streamEvent',
          eventType: ev.event,
          name: ev.name,
          run_id: ev.run_id,
          parent_ids_count: ev.parent_ids?.length,
          metadataKeys: ev.metadata ? Object.keys(ev.metadata) : [],
        }));
      }
      // Forward stream events to attached BaseCallbackHandler instances. JS
      // LangGraph's `streamEvents` doesn't reliably propagate config.callbacks
      // down to nested tool / LLM invocations, so the AgentTracer's hooks
      // never fire and AgentTraceEnvelope.toolCalls ships empty. Translating
      // stream events into the equivalent BaseCallbackHandler method calls
      // populates the tracer the same way `.invoke(input, { callbacks })`
      // would in the standard agent-orchestrator flow.
      const runId = ev.run_id ?? '';
      const parentRunId = ev.parent_ids?.[ev.parent_ids.length - 1];
      switch (ev.event) {
        case 'on_chain_start':
          for (const cb of callbacks) {
            cb.handleChainStart?.(
              { kwargs: { name: ev.name }, id: [ev.name ?? 'chain'] } as any,
              ev.data?.input,
              runId,
              parentRunId,
            );
          }
          break;
        case 'on_chain_end':
          for (const cb of callbacks) {
            cb.handleChainEnd?.(ev.data?.output, runId);
          }
          // Track latest top-level graph output. LangGraph emits on_chain_end
          // for each node and once for the LangGraph itself; the LangGraph
          // run's output is the merged final state.
          if (ev.name === 'LangGraph' && ev.data?.output && typeof ev.data.output === 'object') {
            finalState = ev.data.output as Record<string, unknown>;
          }
          break;
        case 'on_chat_model_start':
        case 'on_llm_start':
          for (const cb of callbacks) {
            cb.handleLLMStart?.(
              { kwargs: { model: ev.metadata?.['ls_model_name'], modelName: ev.metadata?.['ls_model_name'] }, id: [ev.name ?? 'llm'] } as any,
              [],
              runId,
              parentRunId,
              undefined,
              undefined,
              ev.metadata,
            );
          }
          break;
        case 'on_chat_model_end':
        case 'on_llm_end':
          for (const cb of callbacks) {
            cb.handleLLMEnd?.(
              { generations: [], llmOutput: { tokenUsage: (ev.data?.output as { usage_metadata?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage_metadata } },
              runId,
            );
          }
          if (textOpened) {
            subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent);
            textOpened = false;
          }
          toolCallsEmitted += this.emitToolCallsFromAIMessage(ev, subscriber, messageId);
          break;
        case 'on_tool_start': {
          // LangGraph streamEvents wraps tool input as `{ input: <args> }` for
          // some Runnable variants. Unwrap so AgentTracer sees the actual
          // arg keys (e.g. ["query"]) rather than ["input"].
          const rawInput = ev.data?.input;
          const argsObj =
            rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) && 'input' in (rawInput as Record<string, unknown>)
              ? (rawInput as { input: unknown }).input
              : rawInput;
          const inputStr = typeof argsObj === 'string' ? argsObj : JSON.stringify(argsObj ?? {});
          for (const cb of callbacks) {
            try {
              cb.handleToolStart?.(
                { kwargs: { name: ev.name }, id: [ev.name ?? 'tool'] } as any,
                inputStr,
                runId,
                parentRunId,
              );
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('handleToolStart threw', (err as Error).message);
            }
          }
          break;
        }
        case 'on_tool_end':
          for (const cb of callbacks) {
            try {
              cb.handleToolEnd?.(
                typeof ev.data?.output === 'string' ? ev.data.output : JSON.stringify(ev.data?.output ?? ''),
                runId,
              );
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('handleToolEnd threw', (err as Error).message);
            }
          }
          break;
        case 'on_tool_error':
          for (const cb of callbacks) {
            cb.handleToolError?.(
              new Error(typeof ev.data?.output === 'string' ? ev.data.output : 'tool error'),
              runId,
            );
          }
          break;
        case 'on_chat_model_stream':
          textOpened = this.streamTextDelta(ev, subscriber, messageId, textOpened);
          break;
      }
    }

    if (textOpened) {
      subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent);
    }

    if (finalState) {
      const snapshot: Record<string, unknown> = {};
      for (const key of STATE_SNAPSHOT_KEYS) {
        const v = finalState[key];
        if (v !== undefined) snapshot[key] = v;
      }
      subscriber.next({
        type: EventType.STATE_SNAPSHOT,
        snapshot,
      } as StateSnapshotEvent);
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'OnboardingAgent stream complete',
      threadId: input.threadId,
      runId: input.runId,
      eventCounts,
      toolCallsEmitted,
    }));

    subscriber.next({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    } as RunFinishedEvent);
  }

  private streamTextDelta(
    ev: LangGraphStreamEvent,
    subscriber: Subscriber<BaseEvent>,
    messageId: string,
    textOpened: boolean,
  ): boolean {
    const chunk = ev.data?.chunk;
    if (!chunk) return textOpened;
    const text = extractText(chunk.content);
    if (!text) return textOpened;
    if (!textOpened) {
      subscriber.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      } as TextMessageStartEvent);
      textOpened = true;
    }
    subscriber.next({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: text,
    } as TextMessageContentEvent);
    return textOpened;
  }

  private emitToolCallsFromAIMessage(
    ev: LangGraphStreamEvent,
    subscriber: Subscriber<BaseEvent>,
    messageId: string,
  ): number {
    const output = ev.data?.output;
    const toolCalls = output?.tool_calls ?? [];
    let emitted = 0;
    for (const tc of toolCalls) {
      const id = tc.id ?? randomUUID();
      const name = tc.name ?? '';
      // tc.args is the parsed object; AG-UI expects the JSON string.
      const argsString = typeof tc.args === 'string'
        ? tc.args
        : JSON.stringify(tc.args ?? {});
      subscriber.next({
        type: EventType.TOOL_CALL_START,
        toolCallId: id,
        toolCallName: name,
        parentMessageId: messageId,
      } as ToolCallStartEvent);
      subscriber.next({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: id,
        delta: argsString,
      } as ToolCallArgsEvent);
      subscriber.next({
        type: EventType.TOOL_CALL_END,
        toolCallId: id,
      } as ToolCallEndEvent);
      emitted += 1;
    }
    return emitted;
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}
