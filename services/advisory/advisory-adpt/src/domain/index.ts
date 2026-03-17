export { AdvisoryCrossDomainEventTypes } from './events';
export type { AdvisoryCrossDomainEventType } from './events';

// Cross-domain subset types (defined locally to avoid circular deps)
// Source of truth: @nestfolio/advisory-ctrl/service → models.ts

/** Status of a decision packet through its lifecycle. */
export type DecisionStatus =
  | 'DRAFT'
  | 'PROPOSED'
  | 'COMPLIANCE_REVIEW'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CONFIRMATION_REQUIRED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'FILLED'
  | 'FAILED';

/** Compliance check level. */
export type ComplianceLevel = 'L1' | 'L2' | 'L3';

/** Compliance check result. */
export type ComplianceResult = 'PASSED' | 'FAILED' | 'ESCALATED';

/** A proposed trade within a decision packet. */
export interface ProposedTrade {
  readonly symbol: string;
  readonly assetClass: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;
  readonly targetWeightPercent: number;
  readonly rationale: string;
}

/** Result of a compliance check on a decision. */
export interface ComplianceCheck {
  readonly checkId: string;
  readonly decisionId: string;
  readonly level: ComplianceLevel;
  readonly ruleName: string;
  readonly result: ComplianceResult;
  readonly details: string;
  readonly checkedAt: string;
}
