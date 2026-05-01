import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createPhaseNode, OnboardingToolCallFailure, phaseToRenderTool } from '../../../src/agent/phase-node';
import { PHASE_ORDER, type Phase } from '../../../src/agent/state';
import { RENDER_TOOLS } from '../../../src/agent/tools/render-ui';

interface FakeModel {
  invoke: jest.Mock;
  bindTools: jest.Mock;
}

function makeModel(responses: AIMessage[]): { model: FakeModel; defaultBound: FakeModel; pinnedBound: FakeModel } {
  const defaultInvoke = jest.fn();
  const pinnedInvoke = jest.fn();
  const defaultBound: FakeModel = { invoke: defaultInvoke, bindTools: jest.fn() };
  const pinnedBound: FakeModel = { invoke: pinnedInvoke, bindTools: jest.fn() };
  // First bindTools call (in node body) returns defaultBound (tool_choice: 'any').
  // Second bindTools call (in retry path) returns pinnedBound (tool_choice: <name>).
  const bindTools = jest.fn().mockReturnValueOnce(defaultBound).mockReturnValue(pinnedBound);
  const model: FakeModel = { invoke: jest.fn(), bindTools };
  // First response goes to defaultBound; subsequent ones to pinnedBound.
  if (responses.length > 0) {
    defaultInvoke.mockResolvedValueOnce(responses[0]);
  }
  for (let i = 1; i < responses.length; i++) {
    pinnedInvoke.mockResolvedValueOnce(responses[i]);
  }
  return { model, defaultBound, pinnedBound };
}

function aiMsgWithToolCall(toolName: string, args: Record<string, unknown> = {}): AIMessage {
  return new AIMessage({
    content: '',
    tool_calls: [{ id: 'tc-1', name: toolName, args, type: 'tool_call' }],
  });
}

function aiMsgEmpty(): AIMessage {
  return new AIMessage({ content: '', tool_calls: [] });
}

const baseDeps = (model: FakeModel) => ({
  model: model as any,
  tools: [],
  toolsByName: {
    commit_phase: { invoke: jest.fn().mockResolvedValue('committed') },
    search_knowledge_base: { invoke: jest.fn().mockResolvedValue('kb result') },
  },
});

describe('phase-node — named-tool retry guard', () => {
  it('first attempt succeeds — exactly one model invocation, no retry', async () => {
    const { model, defaultBound, pinnedBound } = makeModel([aiMsgWithToolCall('render_options')]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [new HumanMessage('Iniziamo.')],
    });

    expect(defaultBound.invoke).toHaveBeenCalledTimes(1);
    expect(pinnedBound.invoke).not.toHaveBeenCalled();
    expect(result['phaseRetryCount']).toBe(0);
    expect(result['phaseFailures']).toBeUndefined();
  });

  it('empty tool_calls → retry pinned to render_X for the phase', async () => {
    const { model, defaultBound, pinnedBound } = makeModel([
      aiMsgEmpty(),
      aiMsgWithToolCall('render_options'),
    ]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [new HumanMessage('Iniziamo.')],
    });

    expect(defaultBound.invoke).toHaveBeenCalledTimes(1);
    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    // Second bindTools call must have used the pinned named tool_choice (plain string).
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: 'render_options',
    });
    expect(result['phaseRetryCount']).toBe(1);
    expect(result['phaseFailures']).toEqual([
      { phase: 'goal', firstAttemptTool: null, expectedTool: 'render_options' },
    ]);
  });

  it('wrong tool name on phase entry → retry pinned to render_X', async () => {
    const { model, pinnedBound } = makeModel([
      aiMsgWithToolCall('search_knowledge_base'),
      aiMsgWithToolCall('render_options'),
    ]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [new HumanMessage('Iniziamo.')],
    });

    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: 'render_options',
    });
    expect(result['phaseRetryCount']).toBe(1);
    expect((result['phaseFailures'] as any[])[0]).toMatchObject({
      firstAttemptTool: 'search_knowledge_base',
      expectedTool: 'render_options',
    });
  });

  it('retry also returns wrong tool → throws OnboardingToolCallFailure', async () => {
    const { model } = makeModel([aiMsgEmpty(), aiMsgEmpty()]);
    const node = createPhaseNode('goal', baseDeps(model));

    const promise = node({ messages: [new HumanMessage('Iniziamo.')] });
    await expect(promise).rejects.toBeInstanceOf(OnboardingToolCallFailure);
    await expect(promise).rejects.toMatchObject({
      phase: 'goal',
      expectedTool: 'render_options',
      attempts: 2,
    });
  });

  it('user response branch → expectedTool = commit_phase', async () => {
    const { model, pinnedBound } = makeModel([
      aiMsgWithToolCall('render_options'),
      aiMsgWithToolCall('commit_phase', { phase: 'goal', data: { goal: 'growth' } }),
    ]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [
        new HumanMessage('Iniziamo.'),
        new AIMessage({ content: '', tool_calls: [{ id: 't', name: 'render_options', args: {}, type: 'tool_call' }] }),
        new HumanMessage('growth'),
      ],
    });

    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: 'commit_phase',
    });
    expect(result['phaseRetryCount']).toBe(1);
  });

  it('product question branch → expectedTool = search_knowledge_base', async () => {
    const { model, pinnedBound } = makeModel([
      aiMsgWithToolCall('commit_phase'),
      aiMsgWithToolCall('search_knowledge_base', { query: 'come funziona Nestfolio per gli investimenti?' }),
    ]);
    const deps = baseDeps(model);
    // The KB-result follow-up uses the bare model (no bindTools wrap). Stub
    // model.invoke directly for that follow-up call so the node body completes.
    (model.invoke as jest.Mock).mockResolvedValue(new AIMessage({ content: 'risposta breve' }));
    const node = createPhaseNode('goal', deps);

    const result = await node({
      messages: [
        new HumanMessage('Iniziamo.'),
        new AIMessage({ content: '', tool_calls: [{ id: 't', name: 'render_options', args: {}, type: 'tool_call' }] }),
        new HumanMessage('come funziona Nestfolio per gli investimenti?'),
      ],
    });

    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: 'search_knowledge_base',
    });
    expect(result['phaseRetryCount']).toBe(1);
  });
});

describe('phaseToRenderTool — phase coverage', () => {
  it('covers every phase in PHASE_ORDER', () => {
    for (const phase of PHASE_ORDER) {
      expect(phaseToRenderTool).toHaveProperty(phase);
    }
  });

  it('every value is a real tool name in RENDER_TOOLS', () => {
    const renderToolNames = new Set(RENDER_TOOLS.map((t) => t.name));
    for (const phase of PHASE_ORDER) {
      const toolName = phaseToRenderTool[phase as Phase];
      expect(renderToolNames.has(toolName)).toBe(true);
    }
  });
});
