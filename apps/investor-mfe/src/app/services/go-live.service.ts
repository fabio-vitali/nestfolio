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

export interface InvestorProfile {
  operatingMode: string;
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

  async updateRiskProfile(toleranceIdx: number, experienceIdx: number): Promise<InvestorProfile> {
    const d = await this.graphql.mutate<{ updateRiskProfile: InvestorProfile }>(
      UPDATE_RISK_PROFILE,
      { toleranceIdx, experienceIdx },
    );
    return d.updateRiskProfile;
  }

  async updateGoal(input: GoalInput): Promise<GoLiveGoal> {
    const d = await this.graphql.mutate<{ updateGoal: GoLiveGoal }>(UPDATE_GOAL, { input });
    return d.updateGoal;
  }

  async updateOperatingMode(mode: string): Promise<InvestorProfile> {
    const d = await this.graphql.mutate<{ updateOperatingMode: InvestorProfile }>(
      UPDATE_OPERATING_MODE,
      { mode },
    );
    return d.updateOperatingMode;
  }

  async confirmGoLive(): Promise<InvestorProfile> {
    const d = await this.graphql.mutate<{ confirmGoLive: InvestorProfile }>(CONFIRM_GO_LIVE, {});
    return d.confirmGoLive;
  }
}
