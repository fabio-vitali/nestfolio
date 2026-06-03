/**
 * Compile-time proof that reconciliation-ctrl's ownership registration rejects
 * the wrong write intents. Verified by `nx run reconciliation-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned owned rows written via record(): allowed.
record('ReconciliationResult', { status: 'OK' });
record('DriftRecord', { instrument: 'AAPL' });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('ReconciliationResult', { status: 'OK' }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('DriftRecord', { instrument: 'AAPL' }, { version: 1 });

export {};
