import { Injectable, inject } from '@angular/core';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { GET_PROFILE } from '../graphql/investor-bff.queries';
import {
  CONFIRM_GO_LIVE,
  UPDATE_RISK_PROFILE,
  UPDATE_GOAL,
  UPDATE_OPERATING_MODE,
} from '../graphql/investor-bff.mutations';

export interface GoLiveBand {
  minEquity: number;
  maxEquity: number;
}

export interface GoLiveRiskProfile {
  score: number;
  band: GoLiveBand;
  toleranceResponse: string;
  experienceLevel: string;
}

export interface GoLiveGoal {
  objective: string;
  targetAmountCents: number;
  currency: string;
  timeHorizonMonths: number;
  targetReturn: number;
}

export interface GoLiveMandate {
  mandateId: string;
  level: string;
  status: string;
  effectiveDate: string;
}

// Mirrors the investor-bff `OperatingMode` GraphQL enum (schema.graphql).
// Backend owns the canonical type (investor-bff domain/models.ts); the MFE
// cannot import across the frontend/backend boundary, so we restate the union.
export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface InvestorProfile {
  operatingMode: OperatingMode;
  executionMode: string;
  goal: GoLiveGoal;
  riskProfile: GoLiveRiskProfile;
  mandate: GoLiveMandate;
}

export interface GoalInput {
  objective?: string;
  targetAmountCents?: number;
  currency?: string;
  timeHorizonMonths?: number;
  targetReturn?: number;
}

@Injectable()
export class GoLiveService {
  private readonly graphql = inject(GraphqlService);

  async getProfile(): Promise<InvestorProfile> {
    const d = await this.graphql.query<{ getProfile: InvestorProfile }>(GET_PROFILE, {});
    return d.getProfile;
  }

  async updateRiskProfile(
    toleranceIdx: number,
    experienceIdx: number,
  ): Promise<{ riskProfile: GoLiveRiskProfile }> {
    const d = await this.graphql.mutate<{ updateRiskProfile: { riskProfile: GoLiveRiskProfile } }>(
      UPDATE_RISK_PROFILE,
      { toleranceIdx, experienceIdx },
    );
    return d.updateRiskProfile;
  }

  async updateGoal(input: GoalInput): Promise<GoLiveGoal> {
    const d = await this.graphql.mutate<{ updateGoal: GoLiveGoal }>(UPDATE_GOAL, { input });
    return d.updateGoal;
  }

  async updateOperatingMode(mode: OperatingMode): Promise<{ operatingMode: OperatingMode }> {
    const d = await this.graphql.mutate<{ updateOperatingMode: { operatingMode: OperatingMode } }>(
      UPDATE_OPERATING_MODE,
      { mode },
    );
    return d.updateOperatingMode;
  }

  async confirmGoLive(): Promise<{ executionMode: string }> {
    const d = await this.graphql.mutate<{ confirmGoLive: { executionMode: string } }>(
      CONFIRM_GO_LIVE,
      {},
    );
    return d.confirmGoLive;
  }
}
