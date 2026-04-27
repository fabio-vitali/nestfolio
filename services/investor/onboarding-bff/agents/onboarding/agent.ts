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
    chunk?: ChunkLike;
    output?: ChunkLike;
  };
}

interface ChunkLike {
  content?: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
  tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }>;
}

interface OnboardingAgentConfig {
  graph: StreamableGraph;
  threadId?: string;
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

    for await (const ev of this.cfg.graph.streamEvents(initial, {
      version: 'v2',
      configurable: { thread_id: input.threadId },
      signal,
    })) {
      recordEvent(`graph:${ev.event}`);
      switch (ev.event) {
        case 'on_chat_model_stream':
          textOpened = this.streamTextDelta(ev, subscriber, messageId, textOpened);
          break;
        case 'on_chat_model_end': {
          if (textOpened) {
            subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent);
            textOpened = false;
          }
          toolCallsEmitted += this.emitToolCallsFromAIMessage(ev, subscriber, messageId);
          break;
        }
      }
    }

    if (textOpened) {
      subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent);
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
