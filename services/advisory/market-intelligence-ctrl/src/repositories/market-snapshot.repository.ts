// MarketSnapshot row key helpers.
//
// The snapshot row is a continuously-projected materialization of the market
// agent's most recent output for a given region. Writes go through the standard
// event-processor `record()` (slow-tier full rebuild) and `update()` (fast-tier
// partial refresh) intents, so this file deliberately exposes only the key
// formula + SK literal — there is no custom SDK code.
//
// Consumed by handlers/event-listener.ts (writer) and Task 8 DWC projector
// (which will mirror these snapshots into DWC's local table).

export const MARKET_SNAPSHOT_SK = 'MarketSnapshot' as const;

export function marketSnapshotPk(region: string): string {
  return `MarketSnapshot#${region}`;
}
