/**
 * Projection keys for DWC-local snapshot rows materialised from IP-ctrl and
 * MI-ctrl events. The SF reads these via Direct DDB GetItem, so the SF and the
 * projector share these key helpers — no cross-service IAM grants required.
 */

export const PROJECTED_IP_SNAPSHOT_SK = 'InvestorProfileSnapshot' as const;
export const PROJECTED_MARKET_SNAPSHOT_SK = 'MarketSnapshot' as const;

export function projectedIpSnapshotPk(tenantId: string, userId: string): string {
  return `InvestorProfileSnapshot#${tenantId}#${userId}`;
}

export function projectedMarketSnapshotPk(region: string): string {
  return `MarketSnapshot#${region}`;
}
