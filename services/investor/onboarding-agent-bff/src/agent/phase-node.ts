import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './prompts/system';
import { PHASE_INSTRUCTIONS } from './prompts/phase-instructions';

export interface PhaseNodeDeps {
  model: ChatBedrockConverse;
  tools: readonly any[];
}

export function createPhaseNode(phaseName: string, deps: PhaseNodeDeps) {
  return async (state: Record<string, unknown>) => {
    const { model, tools } = deps;
    const phaseInstructions = PHASE_INSTRUCTIONS[phaseName];
    const modelWithTools = model.bindTools(tools as any[]);

    const systemMsg = new SystemMessage(`${SYSTEM_PROMPT}\n\n${phaseInstructions}`);
    const messages = [systemMsg, ...(state.messages as any[])];

    const response = await modelWithTools.invoke(messages);
    return { messages: [response], turnCount: 1 };
  };
}
