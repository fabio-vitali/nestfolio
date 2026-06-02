/**
 * dashboard-bff read-model ownership registration (workstream 2).
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement:
 *   - PortfolioSummary / PositionSnapshot : P1 → projectVersioned only
 *     (accumulate/project/update on them fail typecheck).
 *   - AdvisoryStatus : P3 → projectVersioned of advisory-bff's announced
 *     authoritative aggregate (accumulate on it fails typecheck).
 *   - Activity : P2 append-log → record only.
 *
 *   - InvestorSnapshot : P1 → projectVersioned (workstream 4 — producer now
 *     stamps __version and keeps onboardingCompletedAt stable).
 *
 *   - TimeTravelAvailability : P1 → projectVersioned (WS-C — keyed on
 *     LEDGER_ENTRY_RECORDED.lastEventSequence as __version).
 *
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    PositionSnapshot: Projection<'P1'>;
    InvestorSnapshot: Projection<'P1'>;
    TimeTravelAvailability: Projection<'P1'>;
    AdvisoryStatus: Projection<'P3'>;
    Activity: Projection<'P2'>;
  }
}

export {};
