/**
 * Compile-time proof that ledger-bff's ownership registration rejects the wrong
 * write intents. A `@ts-expect-error` that does NOT error is itself a compile
 * failure. Verified by tsc (see below) — no runtime assertions.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// P1 rows: projectVersioned is the only blessed write.
projectVersioned('PortfolioLatest', { a: 1 }, { version: 1 });
projectVersioned('Position', { a: 1 }, { version: 1 });
projectVersioned('Simulation', { a: 1 }, { version: 1 });
projectVersioned('SimulationPosition', { a: 1 }, { version: 1 });

// @ts-expect-error — unconditional project on a P1 projection must not typecheck
project('PortfolioLatest', { a: 1 });
// @ts-expect-error — accumulate on a P1 projection must not typecheck
accumulate('Position', { field: 'count', increment: 1 });
// @ts-expect-error — command update on a P1 projection must not typecheck
update('Simulation', { a: 1 });
// @ts-expect-error — record (append) on a P1 projection must not typecheck
record('SimulationPosition', { a: 1 });

// P2 append-logs: record is the blessed write; projectVersioned is rejected.
record('SnapshotAt', { a: 1 });
record('HistoryEntry', { a: 1 });
record('Checkpoint', { a: 1 });

// @ts-expect-error — projectVersioned on a P2 append-log must not typecheck
projectVersioned('SnapshotAt', { a: 1 }, { version: 1 });
// @ts-expect-error — project on a P2 projection must not typecheck
project('HistoryEntry', { a: 1 });

export {};
