import { Injectable, inject } from '@angular/core';
import {
  GraphqlService,
  RECORD_ONBOARDING_ANSWER,
  SET_GOAL,
  SET_RISK_PROFILE,
  SELECT_OPERATING_MODE,
  GRANT_MANDATE,
} from '@nestfolio/appsync-client';
import type { Goal, Mandate, RiskProfile } from '@nestfolio/domain-core';
import type { GoalInput, MandateInput, OperatingMode, RiskProfileInput } from '../stores/onboarding.store';

@Injectable()
export class OnboardingService {
  private readonly graphql = inject(GraphqlService);

  async recordOnboardingAnswer(
    input: { step: string; payload: Record<string, string> },
  ): Promise<{ step: string; answeredAt: string }> {
    const data = await this.graphql.mutate<{ recordOnboardingAnswer: { step: string; answeredAt: string } }>(
      RECORD_ONBOARDING_ANSWER,
      { input },
    );
    return data.recordOnboardingAnswer;
  }

  async setGoal(input: GoalInput): Promise<Goal> {
    const data = await this.graphql.mutate<{ setGoal: Goal }>(SET_GOAL, { input });
    return data.setGoal;
  }

  async setRiskProfile(input: RiskProfileInput): Promise<RiskProfile> {
    const data = await this.graphql.mutate<{ setRiskProfile: RiskProfile }>(SET_RISK_PROFILE, { input });
    return data.setRiskProfile;
  }

  async selectOperatingMode(
    mode: OperatingMode,
  ): Promise<{ operatingMode: string; updatedAt: string }> {
    const data = await this.graphql.mutate<{ selectOperatingMode: { operatingMode: string; updatedAt: string } }>(
      SELECT_OPERATING_MODE,
      { mode },
    );
    return data.selectOperatingMode;
  }

  async grantMandate(input: MandateInput): Promise<Mandate> {
    const data = await this.graphql.mutate<{ grantMandate: Mandate }>(GRANT_MANDATE, { input });
    return data.grantMandate;
  }
}
