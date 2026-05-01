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

/**
 * Maps each onboarding phase to its expected render_* tool. Used by the
 * named-tool retry guard to pin tool_choice when the first invoke returns
 * an unexpected tool. Tool names match RENDER_TOOLS in
 * `services/investor/onboarding-bff/src/agent/tools/render-ui.ts`.
 */
export const phaseToRenderTool: Record<Phase, string> = {
  goal:            'render_options',
  operating_mode:  'render_mode_cards',
  horizon:         'render_slider',
  capital:         'render_amount',
  mandate_summary: 'render_summary',
  mandate_consent: 'render_consent',
  mandate_cta:     'render_cta',
};

/**
 * Thrown by the phase node when the named-tool retry also fails to produce
 * the expected tool. AbstractAgent's runStream catch maps this to a RUN_ERROR
 * AG-UI event; the browser surfaces the existing 'Riprova' UX. Grep-friendly
 * message shape.
 */
export class OnboardingToolCallFailure extends Error {
  readonly phase: string;
  readonly expectedTool: string;
  readonly attempts: number;
  constructor(args: { phase: string; expectedTool: string; attempts: number }) {
    super(
      `OnboardingToolCallFailure: phase=${args.phase} expectedTool=${args.expectedTool} attempts=${args.attempts}`,
    );
    this.name = 'OnboardingToolCallFailure';
    this.phase = args.phase;
    this.expectedTool = args.expectedTool;
    this.attempts = args.attempts;
  }
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

    // Compute the tool the model is expected to call this turn — drives the
    // named-tool retry guard if the first invoke returns zero or wrong-named
    // tool calls. Branches mirror the `guidance` block above.
    const expectedTool: string =
        isProductQuestion ? 'search_knowledge_base'
      : userHasResponded  ? 'commit_phase'
      :                     phaseToRenderTool[phaseName as Phase];

    let response = (await modelWithTools.invoke(messages)) as AIMessage;
    let phaseRetryCount = 0;
    let phaseFailure: { phase: string; firstAttemptTool: string | null; expectedTool: string } | undefined;
    const firstToolName = response.tool_calls?.[0]?.name ?? null;

    if (firstToolName !== expectedTool) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        level: 'WARN',
        message: 'phase-node retry pinned to expected tool',
        phase: phaseName,
        expectedTool,
        firstAttemptTool: firstToolName,
      }));
      phaseRetryCount = 1;
      phaseFailure = { phase: phaseName, firstAttemptTool: firstToolName, expectedTool };
      const pinnedModel = model.bindTools(tools as any[], {
        tool_choice: expectedTool,
      });
      response = (await pinnedModel.invoke(messages)) as AIMessage;
      if ((response.tool_calls?.[0]?.name ?? null) !== expectedTool) {
        throw new OnboardingToolCallFailure({
          phase: phaseName,
          expectedTool,
          attempts: 2,
        });
      }
    }

    const updates: Record<string, unknown> = {
      messages: [response],
      turnCount: 1,
      phaseRetryCount,
    };
    if (phaseFailure) {
      updates['phaseFailures'] = [phaseFailure];
    }

    const tc = response.tool_calls?.[0];
    if (!tc) {
      return updates;
    }

    if (tc.name === 'commit_phase') {
      const tool = toolsByName['commit_phase'];
      // Identity (tenantId/userId/sessionId) is no longer in the tool input —
      // commit_phase reads it from RunnableConfig.configurable, populated
      // server-side from the verified Cognito JWT (see
      // agents/onboarding/server.ts). We only normalize `phase` here as a
      // defence against the LLM forgetting to set it.
      const args: Record<string, unknown> = { ...(tc.args as Record<string, unknown>) };
      args['phase'] = args['phase'] ?? phaseName;

      // For mandate_consent the tool persists the OnboardingCompleted CDC
      // record from `allPhases`. The LLM has been observed to hallucinate
      // '<UNKNOWN>' placeholders when re-emitting state it can't see — that
      // garbage then propagates into the CDC record (`horizonYears: '<UNKNOWN>'`)
      // and downstream investor-bff's transactWrite fails with a DDB
      // ValidationException on `<UNKNOWN>' * 12 = NaN`. Build `allPhases`
      // from the accumulated graph state we control, not from tool args.
      if (args['phase'] === 'mandate_consent') {
        args['allPhases'] = buildAllPhasesFromState(state);
      }

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

/**
 * Build the `allPhases` map for `commit_phase('mandate_consent', ...)` from
 * graph state rather than trusting LLM-supplied args. The phase nodes
 * accumulate `goal`, `operatingMode`, `horizonYears`, `capitalAmount`
 * during their respective commits (see `stateFields` block above), so by
 * mandate_consent time the state IS the source of truth.
 *
 * Shape mirrors `OnboardingRepository.completeSession`'s consumption (see
 * `services/investor/onboarding-bff/src/repositories/onboarding.repository.ts`).
 * Defaults match the schema's permissive fields (currency EUR, simulation
 * mode, neutral risk indices) — these surfaces don't have a UI step in the
 * current wizard, so the wizard would otherwise rely on the LLM to fabricate
 * values, which is exactly what we are protecting against.
 */
function buildAllPhasesFromState(state: Record<string, unknown>): Record<string, unknown> {
  const goal = state['goal'];
  const horizonYears = state['horizonYears'];
  const capitalAmount = state['capitalAmount'];
  const operatingMode = state['operatingMode'];
  return {
    goal: typeof goal === 'string' ? { objective: goal } : undefined,
    horizon: typeof horizonYears === 'number' ? { years: horizonYears } : undefined,
    mode: { accountMode: 'simulation' },
    capital: typeof capitalAmount === 'number' ? { amount: capitalAmount, currency: 'EUR' } : undefined,
    risk: { toleranceIdx: 1, experienceIdx: 1, score: 50, category: 'moderate' },
    operatingMode: typeof operatingMode === 'string' ? { mode: operatingMode.toUpperCase() } : undefined,
    mandate: { accepted: true },
  };
}
