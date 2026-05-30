/**
 * dashboard-bff read-model ownership registration (workstream 2).
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement:
 *   - PortfolioSummary / PositionSnapshot : P1 → projectVersioned only
 *     (accumulate/project/update on them fail typecheck).
 *   - Activity : P2 append-log → record only.
 *
 * NOT registered (intentional carry-overs, see the w2 plan "Out of scope"):
 *   - InvestorSnapshot → P1 deferred to w4 (producer __version + stable onboardedAt).
 *   - AdvisoryStatus → P3 deferred to w3 (needs authoritative decision rows).
 *   - TimeTravelAvailability → untouched.
 *
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    PositionSnapshot: Projection<'P1'>;
    Activity: Projection<'P2'>;
  }
}

export {};
