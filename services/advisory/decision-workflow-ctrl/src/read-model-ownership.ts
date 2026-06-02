/**
 * decision-workflow-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionPacket : CommandOwned own-aggregate (update() + self-incremented
 *     __version) → projectVersioned fails typecheck.
 * DWC's mirror rows (MandateSnapshot/InvestorProfileSnapshot/MarketSnapshot/
 * LedgerSnapshot) are Projection<'P1'> and are registered in WS-C, not here.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionPacket: CommandOwned;
  }
}

export {};
