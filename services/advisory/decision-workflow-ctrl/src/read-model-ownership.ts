/**
 * decision-workflow-ctrl read-model ownership registration.
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionPacket : CommandOwned own-aggregate (update() + self-incremented
 *     __version) → projectVersioned fails typecheck.
 *   - LedgerSnapshot / InvestorProfileSnapshot / MarketSnapshot / MandateSnapshot :
 *     DWC-local MIRRORS of rows owned elsewhere. Projection<'P1'> →
 *     projectVersioned only, keyed on the upstream version carried by CDC. The
 *     owners register the same typenames CommandOwned in their own services —
 *     legal because the drift-checker's R4 is per-service scoped. MandateSnapshot
 *     rides the investor-bff Mandate __version line (read-model-ownership-mandate-projection-fix).
 */
import type { CommandOwned, Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionPacket: CommandOwned;
    LedgerSnapshot: Projection<'P1'>;
    InvestorProfileSnapshot: Projection<'P1'>;
    MarketSnapshot: Projection<'P1'>;
    MandateSnapshot: Projection<'P1'>;
  }
}

export {};
