/** Operating mode determines the advisory style and risk parameters. */
export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

/** Execution mode determines whether trades are simulated or sent to a live broker. */
export type ExecutionMode = 'simulation' | 'live';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';

/** Rebalance cadence for the mandate. */
export type RebalanceCadence = 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' | 'QUARTERLY';

/** Notification delivery channel. */
export type NotificationChannel = 'PUSH' | 'EMAIL' | 'SMS' | 'IN_APP';

/** Notification status lifecycle. */
export type NotificationStatus =
  | 'CREATED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ';

/** Risk profile for an investor, derived from onboarding questionnaire. */
export interface RiskProfile {
  readonly profileId: string;
  readonly tenantId: string;
  readonly score: number;
  readonly band: {
    readonly minEquity: number;
    readonly maxEquity: number;
  };
  readonly assessedAt: string;
  readonly version: number;
}

/** Investment goal set by the investor. */
export interface Goal {
  readonly goalId: string;
  readonly tenantId: string;
  readonly objective: string;
  readonly targetAmountCents: number;
  readonly currency: string;
  readonly timeHorizonMonths: number;
  readonly targetReturn: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Mandate defines the rules under which the advisory engine can act. */
export interface Mandate {
  readonly mandateId: string;
  readonly tenantId: string;
  readonly level: MandateLevel;
  readonly monthlyTurnoverCapPercent: number;
  readonly maxSingleTradePercent: number;
  readonly coolDownDays: number;
  readonly rebalanceCadence: RebalanceCadence;
  readonly effectiveDate: string;
  readonly revokedAt: string | null;
  readonly version: number;
}

/** Full investor profile aggregate. */
export interface InvestorProfile {
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  readonly age: number;
  readonly locale: string;
  readonly operatingMode: OperatingMode;
  readonly executionMode: ExecutionMode;
  readonly riskProfile: RiskProfile;
  readonly goals: ReadonlyArray<Goal>;
  readonly mandate: Mandate | null;
  readonly monthlyContributionCents: number;
  readonly currency: string;
  readonly onboardingCompletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Written to DDB when the investor switches execution mode; triggers EXECUTION_MODE_CHANGED via CDC. */
export interface ExecutionModeChange {
  readonly changeId: string;
  readonly tenantId: string;
  readonly fromMode: ExecutionMode;
  readonly toMode: ExecutionMode;
  readonly changedAt: string;
}

/** Notification sent to the investor. */
export interface Notification {
  readonly notificationId: string;
  readonly tenantId: string;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly body: string;
  readonly status: NotificationStatus;
  readonly relatedEntityType: string;
  readonly relatedEntityId: string;
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
}
