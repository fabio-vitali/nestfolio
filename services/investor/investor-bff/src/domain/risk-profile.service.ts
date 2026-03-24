const TOLERANCE_LABELS = ['hold', 'cautious', 'selective', 'aggressive'] as const;
const EXPERIENCE_LABELS = ['novice', 'beginner', 'intermediate', 'expert'] as const;

export interface RiskProfileResult {
  score: number;
  band: { minEquity: number; maxEquity: number };
  tolerance: string;
  experienceLevel: string;
  category: 'conservative' | 'moderate' | 'aggressive';
}

/** Authoritative risk scoring -- investor-bff owns this algorithm. */
export function computeRiskProfile(toleranceIdx: number, experienceIdx: number): RiskProfileResult {
  const t = Math.max(0, Math.min(3, Math.round(toleranceIdx)));
  const e = Math.max(0, Math.min(3, Math.round(experienceIdx)));

  const raw = (t * 0.6 + e * 0.4) / 3;
  const score = Math.min(100, Math.round(raw * 100 + 0.5));

  const category = score < 34 ? 'conservative' as const
    : score < 67 ? 'moderate' as const
    : 'aggressive' as const;

  const band = category === 'conservative' ? { minEquity: 0.1, maxEquity: 0.3 }
    : category === 'moderate' ? { minEquity: 0.3, maxEquity: 0.6 }
    : { minEquity: 0.6, maxEquity: 0.9 };

  return {
    score,
    band,
    tolerance: TOLERANCE_LABELS[t],
    experienceLevel: EXPERIENCE_LABELS[e],
    category,
  };
}
