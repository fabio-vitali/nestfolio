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
  readonly score: number;
  readonly band: {
    readonly minEquity: number;
    readonly maxEquity: number;
  };
  readonly toleranceResponse: 'cautious' | 'neutral' | 'bold';
  readonly experienceLevel: 'beginner' | 'intermediate' | 'expert';
}

/** Investment goal set by the investor. */
export interface Goal {
  readonly objective: string;
  readonly targetAmountCents: number;
  readonly currency: string;
  readonly timeHorizonMonths: number;
  readonly targetReturn: number;
}

export type MandateStatusValue = 'ACTIVE' | 'REVOKED';

/** Authority grant — sibling row at sk='Mandate'. Lifecycle only, no policy fields. */
export interface Mandate {
  readonly mandateId: string;
  readonly level: MandateLevel;
  readonly status: MandateStatusValue;
  readonly effectiveDate: string;
  readonly revokedAt: string | null;
}

/** Account funding mode (simulation vs live capital). */
export interface AccountMode {
  readonly mode: 'simulation' | 'live';
  readonly capitalAmount: number;
  readonly currency: string;
}

/** Full investor profile aggregate (composite single-row shape). */
export interface InvestorProfile {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly operatingMode: OperatingMode;
  readonly executionMode: ExecutionMode;
  readonly accountMode: AccountMode;
  readonly goal: Goal;
  readonly riskProfile: RiskProfile;
  readonly mandateLevel: MandateLevel;
  readonly mandateId: string;
  readonly onboardingCompletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Mandate lifecycle status row — single row per (tenantId, userId). */
export interface MandateStatus {
  readonly tenantId: string;
  readonly userId: string;
  readonly status: 'ACCEPTED' | 'REVOKED';
  readonly acceptedAt: string;
  readonly revokedAt: string | null;
  readonly region: string;
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
