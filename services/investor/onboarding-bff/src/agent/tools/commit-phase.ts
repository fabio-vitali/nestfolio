import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OnboardingRepository } from '../../repositories/onboarding.repository';
import { PHASE_ORDER, nextPhase, phaseIndexOf, type Phase } from '../state';
import type { Phases } from '../../domain/schemas';

const CommitPhaseSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  phase: z.enum(PHASE_ORDER),
  data: z.record(z.unknown()),
  /** Required only for the consent phase — the full accumulated phases map */
  allPhases: z.record(z.unknown()).optional(),
});

export function createCommitPhaseTool(repo: OnboardingRepository): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'commit_phase',
    description: 'Persist phase data and advance to the next phase. On mandate_consent phase, completes the session.',
    schema: CommitPhaseSchema,
    func: async (input) => {
      const { tenantId, userId, sessionId, phase, data, allPhases } = input;
      const next = nextPhase(phase as Phase);
      const nextIdx = next === 'completed' ? PHASE_ORDER.length : phaseIndexOf(next as Phase);

      if (phase === 'mandate_consent' && allPhases) {
        // Note: commit-phase is an agent tool without access to EventContext.
        // Construct a minimal RequestContext from the tool input fields.
        const ctx = { tenantId, userId, region: process.env.AWS_REGION ?? 'us-east-1' };
        await repo.completeSession(sessionId, allPhases as unknown as Phases, ctx as any);
      } else {
        await repo.updatePhase(tenantId, userId, sessionId, phase, data, next, nextIdx);
      }

      return `Phase "${phase}" committed. Next: "${next}".`;
    },
  });
}
