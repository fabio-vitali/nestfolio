/**
 * Compile-time proof that decision-workflow-ctrl's ownership registration rejects
 * the wrong write intents. Verified by `nx run decision-workflow-ctrl:typecheck`.
 */
import { update, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned own-aggregate written via update(): update() is allowed.
update('DecisionPacket', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned aggregate must not typecheck
projectVersioned('DecisionPacket', { a: 1 }, { version: 1 });

export {};
