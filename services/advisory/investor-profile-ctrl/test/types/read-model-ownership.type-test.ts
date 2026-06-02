/**
 * Compile-time proof that investor-profile-ctrl's ownership registration rejects
 * the wrong write intents. Verified by `nx run investor-profile-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned own-aggregate written via record(): record() is allowed.
record('InvestorProfileSnapshot', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned aggregate must not typecheck
projectVersioned('InvestorProfileSnapshot', { a: 1 }, { version: 1 });

export {};
