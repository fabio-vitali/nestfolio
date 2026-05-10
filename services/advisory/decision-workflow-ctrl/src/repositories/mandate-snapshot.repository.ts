export const MANDATE_SNAPSHOT_SK = 'MandateSnapshot' as const;
export function mandateSnapshotPk(tenantId: string, userId: string): string {
  return `MandateSnapshot#${tenantId}#${userId}`;
}
