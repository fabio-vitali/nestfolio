import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage, ToolMessage, type AIMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';
import { SYSTEM_PROMPT } from './prompts/system';
import { PHASE_INSTRUCTIONS } from './prompts/phase-instructions';
import { nextPhase, phaseIndexOf, PHASE_ORDER, type Phase } from './state';

interface PhaseNodeDeps {
  model: ChatBedrockConverse;
  tools: readonly any[];
  toolsByName: Record<string, any>;
}

export function createPhaseNode(phaseName: string, deps: PhaseNodeDeps) {
  return async (state: Record<string, unknown>, config?: any) => {
    const { model, tools, toolsByName } = deps;
    const phaseInstructions = PHASE_INSTRUCTIONS[phaseName] ?? '';
    // tool_choice: 'any' forces SOME tool every turn — the prompt + history
    // steer the model between render_X (initial entry) and commit_phase
    // (after user responded). Bedrock Sonnet 4.6 reliably ignores plain-text
    // "MUST call render_*" instructions without this enforcement.
    const modelWithTools = model.bindTools(tools as any[], { tool_choice: 'any' });

    // Detect whether the user has freshly responded for this phase, OR whether
    // we just looped here from a commit in the prior phase (in which case we
    // are entering this phase fresh and must render).
    //
    // Within a single browser turn the graph can run two phase nodes in
    // sequence: phase_X → commit (ToolMessage appended) → router → phase_(X+1).
    // The lastHumanMessage is still the user's response to phase X, which is
    // semantically not a response to phase X+1 — so we treat last-was-tool as
    // "fresh entry, render".
    const stateMessages = (state.messages as any[]) ?? [];
    const lastMsg = stateMessages[stateMessages.length - 1];
    const lastWasCommit = lastMsg?._getType?.() === 'tool' && lastMsg?.name === 'commit_phase';
    const lastHuman = [...stateMessages].reverse().find((m) => m?._getType?.() === 'human');
    const lastUserText = lastHuman ? String(lastHuman.content ?? '').trim() : '';
    const userHasResponded = !lastWasCommit && !!lastUserText && lastUserText !== 'Iniziamo.';
    // Question detection — if user input ends with '?' OR is clearly natural-
    // language prose (>4 words and not a known phase choice), treat it as a
    // product question and steer toward search_knowledge_base.
    const isProductQuestion =
      userHasResponded &&
      (/\?\s*$/.test(lastUserText) || lastUserText.split(/\s+/).filter(Boolean).length > 4);
    const guidance = isProductQuestion
      ? `\n\nCURRENT TURN CONTEXT: The user just asked a product question: "${lastUserText}". You MUST call search_knowledge_base with { query: "${lastUserText}" }. Do NOT commit_phase or render_* on this turn — keep the user in the current phase.`
      : userHasResponded
      ? `\n\nCURRENT TURN CONTEXT: The user has just responded with: "${lastUserText}". This is their answer to this phase's question. You MUST call commit_phase now (do NOT call render_*). Map the user's response to the schema-required field for this phase: ${phaseName}.`
      : `\n\nCURRENT TURN CONTEXT: This is the entry into the phase — no user response yet for this question. You MUST call the render_* tool named in the phase instructions.`;

    const systemMsg = new SystemMessage(`${SYSTEM_PROMPT}\n\n${phaseInstructions}${guidance}`);
    const messages = [systemMsg, ...stateMessages];

    const response = (await modelWithTools.invoke(messages)) as AIMessage;
    const updates: Record<string, unknown> = {
      messages: [response],
      turnCount: 1,
    };

    const tc = response.tool_calls?.[0];
    if (!tc) {
      return updates;
    }

    if (tc.name === 'commit_phase') {
      const tool = toolsByName['commit_phase'];
      const args: Record<string, unknown> = { ...(tc.args as Record<string, unknown>) };
      args['tenantId'] = args['tenantId'] ?? state['tenantId'] ?? 'unknown';
      args['userId'] = args['userId'] ?? state['userId'] ?? 'unknown';
      args['sessionId'] = args['sessionId'] ?? state['sessionId'] ?? 'unknown';
      args['phase'] = args['phase'] ?? phaseName;

      let result: string;
      try {
        result = await tool.invoke(args, config);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('commit_phase invoke failed', { phase: phaseName, error: (err as Error).message });
        result = `Error committing phase: ${(err as Error).message}`;
      }

      const committedPhase = args['phase'] as Phase;
      const next = nextPhase(committedPhase);
      const nextIdx = next === 'completed' ? PHASE_ORDER.length : phaseIndexOf(next as Phase);
      const phaseData = (args['data'] ?? {}) as Record<string, unknown>;

      const stateFields: Record<string, unknown> = {
        phase: next,
        phaseIndex: nextIdx,
      };
      if (committedPhase === 'goal' && typeof phaseData['goal'] === 'string') {
        stateFields['goal'] = phaseData['goal'];
      }
      if (committedPhase === 'operating_mode' && typeof phaseData['operatingMode'] === 'string') {
        stateFields['operatingMode'] = phaseData['operatingMode'];
      }
      if (committedPhase === 'horizon' && typeof phaseData['horizonYears'] === 'number') {
        stateFields['horizonYears'] = phaseData['horizonYears'];
      }
      if (committedPhase === 'capital' && typeof phaseData['capitalAmount'] === 'number') {
        stateFields['capitalAmount'] = phaseData['capitalAmount'];
      }
      if (committedPhase === 'mandate_consent') {
        stateFields['mandateAccepted'] = true;
      }

      updates.messages = [
        response,
        new ToolMessage({
          content: result,
          tool_call_id: tc.id ?? 'unknown',
          name: 'commit_phase',
        }),
      ];
      Object.assign(updates, stateFields);
    } else if (tc.name === 'search_knowledge_base') {
      const tool = toolsByName['search_knowledge_base'];
      let kbText: string;
      try {
        kbText = (await tool.invoke(tc.args, config)) as string;
      } catch (err) {
        kbText = `Errore: ${(err as Error).message}`;
      }
      const kbToolMsg = new ToolMessage({
        content: kbText,
        tool_call_id: tc.id ?? 'unknown',
        name: 'search_knowledge_base',
      });
      // Follow-up text generation. We pass a fresh, history-free prompt to
      // avoid Bedrock Converse rejecting the call over un-paired tool_use /
      // tool_result blocks accumulated across prior turns. The bare model
      // (no tools bound) emits text only — its `on_chat_model_stream` events
      // surface as TEXT_MESSAGE_* in the AG-UI bridge.
      const followUpSystem = new SystemMessage(
        'You are the Nestfolio onboarding assistant. Respond IN ITALIAN. Answer the user\'s question briefly using the provided knowledge-base context, then add one short sentence inviting the user back to the current onboarding step.',
      );
      const followUpUser = new HumanMessage(
        `Domanda dell'utente: "${lastUserText}"\n\nRisposta dalla knowledge base:\n${kbText}\n\nFormula la risposta finale all'utente.`,
      );
      const followUp = (await model.invoke([followUpSystem, followUpUser], config)) as AIMessage;
      updates.messages = [response, kbToolMsg, followUp];
    } else if (tc.name === 'compute_risk_profile') {
      const tool = toolsByName['compute_risk_profile'];
      const result = await tool.invoke(tc.args, config);
      updates.messages = [
        response,
        new ToolMessage({
          content: typeof result === 'string' ? result : JSON.stringify(result),
          tool_call_id: tc.id ?? 'unknown',
          name: 'compute_risk_profile',
        }),
      ];
    } else {
      // render_* tools: presentation-only. Append a synthetic ToolMessage so
      // subsequent model invocations have a coherent tool_calls/tool_response
      // history pair (Bedrock rejects un-resolved tool_calls).
      updates.messages = [
        response,
        new ToolMessage({
          content: '(rendered)',
          tool_call_id: tc.id ?? 'unknown',
          name: tc.name,
        }),
      ];
    }

    return updates;
  };
}

/**
 * Conditional edge from phase nodes. When phase committed (state.phase
 * advanced), loop through router into next phase node (so the same browser
 * turn renders the next phase's UI). Otherwise end so browser can render the
 * emitted tool.
 */
export function afterPhase(currentPhase: string) {
  return (state: Record<string, unknown>): string => {
    return state['phase'] !== currentPhase ? 'router' : END;
  };
}
