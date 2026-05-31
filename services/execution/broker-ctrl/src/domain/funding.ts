import { record, type WriteIntent } from '@nestfolio/event-processor';

export type FundingStatus = 'requested' | 'detected' | 'settled' | 'failed';
export type FundingDirection = 'DEPOSIT' | 'WITHDRAWAL';

export const STATUS_ORDINAL: Record<FundingStatus, number> = {
  requested: 1,
  detected: 2,
  settled: 3,
  failed: 3,
};

export interface FundingSnapshot {
  eventName: string; // the semantic lifecycle event name (becomes sk + CDC event)
  direction: FundingDirection;
  status: FundingStatus;
  transferId: string;
  tenantId: string;
  userId: string;
  region: string;
  amountCents: number;
  currency: string;
  executionMode: 'simulation' | 'live';
  initiatedAt: string;
  detectedAt?: string;
  settledAt?: string;
  failedAt?: string;
  reason?: string;
  timestamp: string;
}

/**
 * One immutable carrier row per lifecycle transition.
 * pk = Funding#<tenantId>#<transferId>, sk = the lifecycle event name (distinct
 * per transition → clean single-INSERT CDC, no stream coalescing). The row IS the
 * full funding snapshot; CDC `field:'sk', passthrough` re-emits sk as the event,
 * carrying every field. __version is the status ordinal so investor-bff's
 * projectVersioned guard keeps requested<detected<settled ordering.
 */
export function fundingCarrier(s: FundingSnapshot): WriteIntent {
  return record(
    'FundingEvent',
    {
      __typename: 'FundingEvent',
      sk: s.eventName,
      direction: s.direction,
      status: s.status,
      transferId: s.transferId,
      tenantId: s.tenantId,
      userId: s.userId,
      region: s.region,
      amountCents: s.amountCents,
      currency: s.currency,
      executionMode: s.executionMode,
      initiatedAt: s.initiatedAt,
      ...(s.detectedAt ? { detectedAt: s.detectedAt } : {}),
      ...(s.settledAt ? { settledAt: s.settledAt } : {}),
      ...(s.failedAt ? { failedAt: s.failedAt } : {}),
      ...(s.reason ? { reason: s.reason } : {}),
      __version: STATUS_ORDINAL[s.status],
      timestamp: s.timestamp,
    },
    {
      pk: `Funding#${s.tenantId}#${s.transferId}`,
      sk: s.eventName,
    },
  );
}
