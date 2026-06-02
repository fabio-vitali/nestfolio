/**
 * Compile-time proof of dashboard-bff's ReadModelOwnership enforcement.
 * Verified by: pnpm nx run dashboard-bff:typecheck. Every @ts-expect-error MUST fire.
 */
import { project, accumulate, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// P1 — projectVersioned only.
projectVersioned('PortfolioSummary', { a: 1 }, { version: 1 });
projectVersioned('PositionSnapshot', { a: 1 }, { version: 1 });
projectVersioned('InvestorSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error InvestorSnapshot is P1 — unconditional project() is forbidden
project('InvestorSnapshot', { a: 1 });
// @ts-expect-error PortfolioSummary is P1 — project() is forbidden
project('PortfolioSummary', { a: 1 });

// P3 — projectVersioned of the announced aggregate; never accumulate.
projectVersioned('AdvisoryStatus', { pendingDecisionsCount: 1 }, { version: 1 });
// @ts-expect-error AdvisoryStatus is a projection — accumulate is forbidden
accumulate('AdvisoryStatus', { field: 'pendingDecisionsCount', increment: 1 });

// P2 — append log via record.
record('Activity', { activityId: 'a1' });
// @ts-expect-error Activity is an append log (P2), not a versioned projection
projectVersioned('Activity', { a: 1 }, { version: 1 });

// TimeTravelAvailability is P1 (WS-C) — projectVersioned only.
projectVersioned('TimeTravelAvailability', { a: 1 }, { version: 1 });
// @ts-expect-error TimeTravelAvailability is P1 — project() is forbidden
project('TimeTravelAvailability', { a: 1 });

export {};
