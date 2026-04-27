import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './prompts/system';
import { PHASE_INSTRUCTIONS } from './prompts/phase-instructions';

interface PhaseNodeDeps {
  model: ChatBedrockConverse;
  tools: readonly any[];
}

export function createPhaseNode(phaseName: string, deps: PhaseNodeDeps) {
  return async (state: Record<string, unknown>) => {
    const { model, tools } = deps;
    const phaseInstructions = PHASE_INSTRUCTIONS[phaseName];
    // `tool_choice: 'any'` forces the model to call SOME tool on this turn.
    // Sonnet 4.6's default behavior is to write the choices as plain text, so
    // the system prompt's "MUST call render_*" instruction was being ignored
    // and the e2e renderer never mounted. The system prompt + phase
    // instructions tell the model WHICH tool to pick (render_options on goal,
    // render_slider on horizon, etc.) — we just enforce that it picks one.
    const modelWithTools = model.bindTools(tools as any[], { tool_choice: 'any' });

    const systemMsg = new SystemMessage(`${SYSTEM_PROMPT}\n\n${phaseInstructions}`);
    const messages = [systemMsg, ...(state.messages as any[])];

    const response = await modelWithTools.invoke(messages);
    return { messages: [response], turnCount: 1 };
  };
}
