/**
 * ledger-bff read-model ownership registration.
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement:
 *   - P1 rows may ONLY be written via projectVersioned() (project/accumulate/update
 *     on them fail typecheck).
 *   - P2 append-logs may ONLY be written via record().
 * See docs/architecture/READ-MODEL-OWNERSHIP.md for the model.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    // P1 — versioned snapshots fed by ledger-ctrl's monotonic lastEventSequence.
    PortfolioLatest: Projection<'P1'>;
    Position: Projection<'P1'>;
    Simulation: Projection<'P1'>;
    SimulationPosition: Projection<'P1'>;
    // P2 — append-only logs (idempotent, order-independent).
    SnapshotAt: Projection<'P2'>;
    HistoryEntry: Projection<'P2'>;
    Checkpoint: Projection<'P2'>;
  }
}

export {};
