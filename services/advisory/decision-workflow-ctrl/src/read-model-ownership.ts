/**
 * decision-workflow-ctrl read-model ownership registration.
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionPacket : CommandOwned own-aggregate (update() + self-incremented
 *     __version) → projectVersioned fails typecheck.
 *   - LedgerSnapshot / InvestorProfileSnapshot / MarketSnapshot : DWC-local
 *     MIRRORS of rows owned elsewhere (ledger-ctrl / investor-profile-ctrl /
 *     market-intelligence-ctrl). Projection<'P1'> → projectVersioned only,
 *     keyed on the upstream version carried by CDC (WS-C). The owners register
 *     the same typenames CommandOwned in their own services — legal because the
 *     drift-checker's R4 is per-service scoped.
 *
 * MandateSnapshot is NOT registered here — split to
 * read-model-ownership-mandate-projection-fix (blocked on an investor-bff
 * producer fix); it stays drift-checker INFO until that ships.
 */
import type { CommandOwned, Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionPacket: CommandOwned;
    LedgerSnapshot: Projection<'P1'>;
    InvestorProfileSnapshot: Projection<'P1'>;
    MarketSnapshot: Projection<'P1'>;
  }
}

export {};
