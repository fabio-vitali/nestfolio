// InvestorProfileSnapshot row key helpers.
//
// The snapshot row is a continuously-projected materialization of the agent's
// most recent output for a given (tenantId, userId). Writes go through the
// standard event-processor `record()` intent, so this file deliberately exposes
// only the key formula + SK literal — there is no custom SDK code.
//
// Consumed by handlers/event-listener.ts (writer) and Task 8 DWC projector
// (which will mirror these snapshots into DWC's local table).

export const INVESTOR_PROFILE_SNAPSHOT_SK = 'InvestorProfileSnapshot' as const;

export function investorProfileSnapshotPk(tenantId: string, userId: string): string {
  return `InvestorProfileSnapshot#${tenantId}#${userId}`;
}
