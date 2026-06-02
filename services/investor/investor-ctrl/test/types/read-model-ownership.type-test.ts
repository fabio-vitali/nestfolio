/**
 * Compile-time proof that investor-ctrl's ownership registration rejects the
 * wrong write intents. Verified by `nx run investor-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned rows seeded by one idempotent event: record() is allowed.
record('Notification', { a: 1 });
record('MonthlyReport', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('Notification', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('MonthlyReport', { a: 1 }, { version: 1 });

export {};
