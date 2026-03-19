import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OnboardingRepository } from '../../repositories/onboarding.repository';
import { PHASE_ORDER, nextPhase, phaseIndexOf, type Phase } from '../state';

const CommitPhaseSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  phase: z.enum(PHASE_ORDER),
  data: z.record(z.unknown()),
});

export function createCommitPhaseTool(repo: OnboardingRepository): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'commit_phase',
    description: 'Persist phase data to DynamoDB and advance to the next phase',
    schema: CommitPhaseSchema,
    func: async (input) => {
      const { tenantId, userId, sessionId, phase, data } = input;

      switch (phase) {
        case 'goal':
          await repo.commitGoal(tenantId, userId, data.goal as string);
          break;
        case 'horizon':
          await repo.commitHorizon(tenantId, userId, data.horizonYears as number);
          break;
        case 'mode':
          await repo.commitAccountMode(tenantId, userId, data.accountMode as 'simulation' | 'live', (data.capitalAmount as number) ?? 0);
          break;
        case 'capital':
          await repo.commitAccountMode(tenantId, userId, (data.accountMode as 'simulation' | 'live') ?? 'simulation', data.capitalAmount as number);
          break;
        case 'risk':
          await repo.commitRiskProfile(tenantId, userId, data.riskProfile as any);
          break;
        case 'operating_mode':
          await repo.commitOperatingMode(tenantId, userId, data.operatingMode as string);
          break;
        case 'mandate':
          await repo.commitMandate(tenantId, userId);
          break;
      }

      const next = nextPhase(phase as Phase);
      const nextIdx = next === 'completed' ? 7 : phaseIndexOf(next as Phase);
      await repo.advanceSession(tenantId, userId, sessionId, next, nextIdx);

      return `Phase "${phase}" committed. Next: "${next}".`;
    },
  });
}
