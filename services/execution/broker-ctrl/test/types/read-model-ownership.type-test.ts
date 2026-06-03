/**
 * Compile-time proof that broker-ctrl's ownership registration rejects the
 * wrong write intents. Verified by `nx run broker-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned cache seeded/refreshed by one idempotent event: record() is allowed.
record('ExecutionMode', { mode: 'simulation' });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('ExecutionMode', { mode: 'simulation' }, { version: 1 });

export {};
