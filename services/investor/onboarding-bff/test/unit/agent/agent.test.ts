import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { EventType } from '@ag-ui/client';
import type { BaseEvent, RunAgentInput } from '@ag-ui/client';
import { OnboardingAgent } from '../../../agents/onboarding/agent';

interface FakeStreamEvent {
  event: string;
  data?: { chunk?: { content?: string; tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }> } };
}

function fakeGraph(events: FakeStreamEvent[], opts: { throwAtEnd?: boolean } = {}) {
  return {
    streamEvents: async function* (_input: unknown, _options: unknown) {
      for (const e of events) {
        yield e;
      }
      if (opts.throwAtEnd) {
        throw new Error('graph blew up');
      }
    },
  };
}

const baseInput: RunAgentInput = {
  threadId: 'thread-1',
  runId: 'run-1',
  messages: [{ id: 'm1', role: 'user', content: 'Hi' } as RunAgentInput['messages'][0]],
  tools: [],
  context: [],
  forwardedProps: {},
  state: {},
};

describe('OnboardingAgent', () => {
  it('emits RUN_STARTED, TEXT_MESSAGE_START/CONTENT/END, RUN_FINISHED for a text-only stream', async () => {
    const graph = fakeGraph([
      { event: 'on_chat_model_stream', data: { chunk: { content: 'Hel' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'lo!' } } },
      { event: 'on_chat_model_end' },
    ]);
    const agent = new OnboardingAgent({ graph, threadId: baseInput.threadId });
    const events = await lastValueFrom(agent.run(baseInput).pipe(toArray())) as BaseEvent[];

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);

    const start = events.find((e) => e.type === EventType.TEXT_MESSAGE_START) as Extract<BaseEvent, { messageId: string }>;
    const end = events.find((e) => e.type === EventType.TEXT_MESSAGE_END) as Extract<BaseEvent, { messageId: string }>;
    expect(start.messageId).toBe(end.messageId);

    const content = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT) as Array<Extract<BaseEvent, { delta: string }>>;
    expect(content.map((c) => c.delta).join('')).toBe('Hello!');
  });

  it('emits TOOL_CALL_START/ARGS/END for a tool-call stream', async () => {
    const graph = fakeGraph([
      {
        event: 'on_chat_model_stream',
        data: {
          chunk: {
            tool_call_chunks: [{ id: 'tc-1', name: 'render_options', args: '{"tit', index: 0 }],
          },
        },
      },
      {
        event: 'on_chat_model_stream',
        data: { chunk: { tool_call_chunks: [{ args: 'le":"Pick"}', index: 0 }] } },
      },
      { event: 'on_chat_model_end' },
    ]);
    const agent = new OnboardingAgent({ graph, threadId: baseInput.threadId });
    const events = await lastValueFrom(agent.run(baseInput).pipe(toArray())) as BaseEvent[];

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.RUN_FINISHED,
    ]);

    const tcStart = events.find((e) => e.type === EventType.TOOL_CALL_START) as Extract<BaseEvent, { toolCallId: string; toolCallName: string }>;
    expect(tcStart.toolCallId).toBe('tc-1');
    expect(tcStart.toolCallName).toBe('render_options');

    const argsEvents = events.filter((e) => e.type === EventType.TOOL_CALL_ARGS) as Array<Extract<BaseEvent, { delta: string; toolCallId: string }>>;
    expect(argsEvents.every((a) => a.toolCallId === 'tc-1')).toBe(true);
    expect(argsEvents.map((a) => a.delta).join('')).toBe('{"title":"Pick"}');
  });

  it('emits a single RUN_ERROR and propagates the Observable error when the graph throws', async () => {
    const graph = fakeGraph(
      [{ event: 'on_chat_model_stream', data: { chunk: { content: 'partial' } } }],
      { throwAtEnd: true },
    );
    const agent = new OnboardingAgent({ graph, threadId: baseInput.threadId });

    const collected: BaseEvent[] = [];
    let errorMsg: string | undefined;
    await new Promise<void>((resolve) => {
      agent.run(baseInput).subscribe({
        next: (e) => collected.push(e),
        error: (err) => {
          errorMsg = err instanceof Error ? err.message : String(err);
          resolve();
        },
        complete: () => resolve(),
      });
    });

    expect(errorMsg).toBe('graph blew up');
    expect(collected.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);
    const runError = collected.find((e) => e.type === EventType.RUN_ERROR) as Extract<BaseEvent, { message: string }>;
    expect(runError.message).toBe('graph blew up');
  });

  it('first emitted event is RUN_STARTED with input threadId and runId', async () => {
    const graph = fakeGraph([{ event: 'on_chat_model_end' }]);
    const agent = new OnboardingAgent({ graph, threadId: baseInput.threadId });
    const first = await firstValueFrom(agent.run(baseInput)) as Extract<BaseEvent, { threadId: string; runId: string }>;
    expect(first.type).toBe(EventType.RUN_STARTED);
    expect(first.threadId).toBe('thread-1');
    expect(first.runId).toBe('run-1');
  });
});
