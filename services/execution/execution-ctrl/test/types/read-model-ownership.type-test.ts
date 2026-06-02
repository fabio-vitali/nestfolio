/**
 * Compile-time proof that execution-ctrl's ownership registration rejects the
 * wrong write intents. Verified by `nx run execution-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned aggregates created via record(): record() is allowed.
record('Order', { a: 1 });
record('StagedOrder', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('Order', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('StagedOrder', { a: 1 }, { version: 1 });

export {};
