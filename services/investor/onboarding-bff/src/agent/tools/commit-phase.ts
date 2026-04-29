import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OnboardingRepository } from '../../repositories/onboarding.repository';
import { PHASE_ORDER, nextPhase, phaseIndexOf, type Phase } from '../state';
import type { Phases } from '../../domain/schemas';

// Identity (tenantId, userId, sessionId) is intentionally NOT part of the
// LLM-visible input schema. The runtime injects identity via
// RunnableConfig.configurable, populated server-side from the verified
// Cognito access token (see agents/onboarding/server.ts). This closes a
// prompt-injection cross-tenant write vector — the LLM cannot supply or
// override these values.
const CommitPhaseSchema = z.object({
  phase: z.enum(PHASE_ORDER),
  data: z.record(z.unknown()),
  /** Required only for the consent phase — the full accumulated phases map */
  allPhases: z.record(z.unknown()).optional(),
});

interface ConfigurableIdentity {
  tenantId?: unknown;
  userId?: unknown;
  sessionId?: unknown;
}

interface RunnableConfigLike {
  configurable?: ConfigurableIdentity;
}

function readIdentity(config: RunnableConfigLike | undefined): { tenantId: string; userId: string; sessionId: string } {
  const c = config?.configurable;
  const tenantId = typeof c?.tenantId === 'string' ? c.tenantId : '';
  const userId = typeof c?.userId === 'string' ? c.userId : '';
  const sessionId = typeof c?.sessionId === 'string' ? c.sessionId : '';
  if (!tenantId || !userId || !sessionId) {
    throw new Error(
      `commit_phase: identity missing on RunnableConfig.configurable (tenantId=${Boolean(tenantId)}, userId=${Boolean(userId)}, sessionId=${Boolean(sessionId)}) — refusing to write`,
    );
  }
  return { tenantId, userId, sessionId };
}

export function createCommitPhaseTool(repo: OnboardingRepository): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'commit_phase',
    description: 'Persist phase data and advance to the next phase. On mandate_consent phase, completes the session.',
    schema: CommitPhaseSchema,
    // The third positional argument to a DynamicStructuredTool's `func` is the
    // RunnableConfig that LangGraph forwards from the graph invocation. See
    // @langchain/core/tools.
    func: async (input, _runManager, config?: RunnableConfigLike) => {
      const { phase, data, allPhases } = input as { phase: Phase; data: Record<string, unknown>; allPhases?: Record<string, unknown> };
      const { tenantId, userId, sessionId } = readIdentity(config);
      const next = nextPhase(phase);
      const nextIdx = next === 'completed' ? PHASE_ORDER.length : phaseIndexOf(next as Phase);

      if (phase === 'mandate_consent' && allPhases) {
        const ctx = { tenantId, userId, region: process.env.AWS_REGION ?? 'us-east-1' };
        await repo.completeSession(sessionId, allPhases as unknown as Phases, ctx as any);
      } else {
        await repo.updatePhase(tenantId, userId, sessionId, phase, data, next, nextIdx);
      }

      return `Phase "${phase}" committed. Next: "${next}".`;
    },
  });
}
