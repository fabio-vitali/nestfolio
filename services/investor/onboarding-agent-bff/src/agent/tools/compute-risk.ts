import type { RiskProfileData } from '../../domain/schemas';

const TOLERANCE_LABELS = ['hold', 'cautious', 'selective', 'aggressive'] as const;
const EXPERIENCE_LABELS = ['novice', 'beginner', 'intermediate', 'expert'] as const;

/**
 * Deterministic risk scoring: pure function, no LLM.
 * @param toleranceIdx 0-3 (from card selection or free-text mapping)
 * @param experienceIdx 0-3 (from card selection or free-text mapping)
 */
export function computeRiskProfile(toleranceIdx: number, experienceIdx: number): RiskProfileData {
  const t = Math.max(0, Math.min(3, Math.round(toleranceIdx)));
  const e = Math.max(0, Math.min(3, Math.round(experienceIdx)));

  // Weighted average: tolerance 60%, experience 40%
  const raw = (t * 0.6 + e * 0.4) / 3;
  const score = Math.min(100, Math.round(raw * 100 + 0.5));

  const category = score < 34 ? 'conservative' as const
    : score < 67 ? 'moderate' as const
    : 'aggressive' as const;

  return {
    tolerance: TOLERANCE_LABELS[t],
    experienceLevel: EXPERIENCE_LABELS[e],
    score,
    category,
  };
}
