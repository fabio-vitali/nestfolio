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
} from '@ag-ui/client';
import { Observable, type Subscriber } from 'rxjs';
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';

// Minimal shape we rely on from the compiled LangGraph. Avoids dragging in the
// concrete `CompiledStateGraph` generic args, which differ between langgraph
// versions and break TS inference.
interface StreamableGraph {
  streamEvents(
    input: unknown,
    options: {
      version: 'v1' | 'v2';
      configurable?: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ): AsyncIterable<LangGraphStreamEvent>;
}

interface LangGraphStreamEvent {
  event: string;
  name?: string;
  data?: {
    chunk?: {
      content?: string | Array<{ type: string; text?: string }>;
      tool_call_chunks?: Array<{
        id?: string;
        name?: string;
        args?: string;
        index?: number;
      }>;
    };
  };
}

interface OnboardingAgentConfig {
  graph: StreamableGraph;
  threadId?: string;
}

/**
 * AG-UI agent that drives the in-process onboarding LangGraph.
 *
 * AG-UI's canonical extension point is subclassing `AbstractAgent` and
 * implementing `run(input)`. We translate LangGraph's `streamEvents` output
 * (`on_chat_model_stream`, `on_chat_model_end`) into AG-UI's
 * TEXT_MESSAGE_* / TOOL_CALL_* events that `@ag-ui/client.HttpAgent`
 * consumes in the browser.
 *
 * `@copilotkit/runtime/langgraph`'s `LangGraphAgent` is hard-wired to a
 * remote LangGraph deployment via `@langchain/langgraph-sdk` and ignores any
 * locally-provided graph — see `node_modules/.../@ag-ui/langgraph/dist/index.mjs`
 * `LangGraphAgentConfig`. Hence this class.
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

    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    // Bedrock Converse rejects empty `human` content. The browser's first run
    // passes `messages: []` (see onboarding-chat.component.ts ngOnInit) — the
    // agent is supposed to render the phase UI without waiting for the user
    // to type. A bare "Iniziamo." kickoff lets the model greet in plain text
    // and ignore the render_* tool, leaving the renderer to never mount.
    // A directive kickoff steers the model to call the render_* tool for the
    // current phase instead of writing prose.
    const userText = (lastUser?.content ?? '').trim()
      || 'Inizia la fase corrente chiamando direttamente lo strumento render_* indicato nelle istruzioni della fase. Non scrivere alcun testo prima del tool call.';

    // The graph reduces messages by appending; we seed with the new user turn
    // and the annotation defaults handle phase/turnCount on first invocation.
    // Subsequent state propagation is the browser's job (passes prior `state`).
    const initial: Record<string, unknown> = {
      ...(input.state as Record<string, unknown> | undefined),
      messages: [new HumanMessage(userText)],
    };

    const messageId = randomUUID();
    let textOpened = false;
    const openToolCalls = new Map<string, { name: string; lastIndex?: number }>();
    let lastToolCallId: string | null = null;

    for await (const ev of this.cfg.graph.streamEvents(initial, {
      version: 'v2',
      configurable: { thread_id: input.threadId },
      signal,
    })) {
      switch (ev.event) {
        case 'on_chat_model_stream':
          this.handleChatModelStream(ev, subscriber, messageId, {
            getTextOpened: () => textOpened,
            setTextOpened: (v) => (textOpened = v),
            openToolCalls,
            getLastToolCallId: () => lastToolCallId,
            setLastToolCallId: (v) => (lastToolCallId = v),
          });
          break;
        case 'on_chat_model_end':
          if (textOpened) {
            subscriber.next({
              type: EventType.TEXT_MESSAGE_END,
              messageId,
            } as TextMessageEndEvent);
            textOpened = false;
          }
          for (const [id] of openToolCalls) {
            subscriber.next({
              type: EventType.TOOL_CALL_END,
              toolCallId: id,
            } as ToolCallEndEvent);
          }
          openToolCalls.clear();
          lastToolCallId = null;
          break;
      }
    }

    if (textOpened) {
      subscriber.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      } as TextMessageEndEvent);
    }
    for (const [id] of openToolCalls) {
      subscriber.next({
        type: EventType.TOOL_CALL_END,
        toolCallId: id,
      } as ToolCallEndEvent);
    }

    subscriber.next({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    } as RunFinishedEvent);
  }

  private handleChatModelStream(
    ev: LangGraphStreamEvent,
    subscriber: Subscriber<BaseEvent>,
    messageId: string,
    s: {
      getTextOpened: () => boolean;
      setTextOpened: (v: boolean) => void;
      openToolCalls: Map<string, { name: string; lastIndex?: number }>;
      getLastToolCallId: () => string | null;
      setLastToolCallId: (v: string | null) => void;
    },
  ): void {
    const chunk = ev.data?.chunk;
    if (!chunk) return;

    const text = extractText(chunk.content);
    if (text) {
      if (!s.getTextOpened()) {
        subscriber.next({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
        } as TextMessageStartEvent);
        s.setTextOpened(true);
      }
      subscriber.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: text,
      } as TextMessageContentEvent);
    }

    for (const tc of chunk.tool_call_chunks ?? []) {
      // Bedrock + most providers only emit `id` + `name` on the first chunk
      // of a tool call. Subsequent arg deltas may have neither — fall back to
      // the most-recently-opened tool call for that stream.
      const resolvedId = tc.id ?? s.getLastToolCallId();
      if (tc.id && !s.openToolCalls.has(tc.id)) {
        s.openToolCalls.set(tc.id, { name: tc.name ?? '', lastIndex: tc.index });
        s.setLastToolCallId(tc.id);
        subscriber.next({
          type: EventType.TOOL_CALL_START,
          toolCallId: tc.id,
          toolCallName: tc.name ?? '',
          parentMessageId: messageId,
        } as ToolCallStartEvent);
      }
      const argsDelta = tc.args ?? '';
      if (argsDelta && resolvedId) {
        subscriber.next({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: resolvedId,
          delta: argsDelta,
        } as ToolCallArgsEvent);
      }
    }
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
