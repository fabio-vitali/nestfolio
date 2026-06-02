/**
 * market-intelligence-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - MarketSnapshot : CommandOwned own-aggregate (one row per region,
 *     upserted continuously via update()) → projectVersioned fails typecheck.
 * The decision-workflow-ctrl MIRROR of MarketSnapshot is a separate physical
 * copy and is registered Projection<'P1'> in WS-C, not here.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    MarketSnapshot: CommandOwned;
  }
}

export {};
