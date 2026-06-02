/**
 * Compile-time proof that market-intelligence-ctrl's ownership registration
 * rejects the wrong write intents. Verified by `nx run market-intelligence-ctrl:typecheck`.
 */
import { update, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned own-aggregate upserted via update(): update() is allowed.
update('MarketSnapshot', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned aggregate must not typecheck
projectVersioned('MarketSnapshot', { a: 1 }, { version: 1 });

export {};
