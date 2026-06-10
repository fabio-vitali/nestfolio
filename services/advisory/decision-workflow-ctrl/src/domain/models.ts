import type { TableEntry, RequestContext, RegionContext } from '@nestfolio/event-processor';

/** Status of a DecisionPacket through the Step Functions workflow.
 *  GENERATING/FAILED are cycle-lifecycle statuses set by advisory-bff (WS-2)
 *  from the SF-direct DECISION_CYCLE_STARTED/FAILED events — no DecisionPacket
 *  row carries them (they describe a cycle with no packet yet). */
export type WorkflowStatus =
  | 'GENERATING'
  | 'PENDING'
  | 'AWAITING_CONFIRMATION'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED';

/** DecisionPacket: the core aggregate owned by decision-workflow-ctrl. */
export interface DecisionPacket {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly trigger: string;
  readonly triggerEventId: string;
  readonly status: WorkflowStatus;
  readonly executionArn: string | null;
  readonly complianceResult: 'APPROVED' | 'BLOCKED' | null;
  readonly authorityLevel: 'L1' | 'L2' | null;
  readonly userDecision: 'CONFIRMED' | 'REJECTED' | null;
  readonly blockReason: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** DWC-local mirror of the upstream InvestorProfileSnapshot.
 * agentOutput is stored JSON-stringified for States.StringToJson SF consumption
 * — hence `string`, not the producer's structured object. */
export type InvestorProfileSnapshotProjectionRow = TableEntry<
  { agentOutput: string; sourceEventId: string },
  RequestContext
> & { readonly __typename: 'InvestorProfileSnapshot'; readonly sk: 'InvestorProfileSnapshot' };

/** DWC-local mirror of the upstream MarketSnapshot (region-scoped).
 * agentOutput JSON-stringified for States.StringToJson SF consumption. */
export type MarketSnapshotProjectionRow = TableEntry<
  { agentOutput: string },
  RegionContext
> & { readonly __typename: 'MarketSnapshot'; readonly sk: 'MarketSnapshot' };
