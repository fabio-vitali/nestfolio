import type { AccountMode, OnboardingSession, RiskProfileData } from './schemas';

export interface OnboardingState {
  phase: 'goal' | 'horizon' | 'mode' | 'capital' | 'risk' | 'operating_mode' | 'mandate';
  phaseIndex: number;
  totalPhases: number;
  goal?: string;
  horizonYears?: number;
  accountMode?: 'simulation' | 'live';
  capitalAmount?: number;
  riskProfile?: RiskProfileData;
  operatingMode?: 'conservative' | 'balanced' | 'aggressive';
  mandateAccepted?: boolean;
}

export type { AccountMode, OnboardingSession, RiskProfileData };
