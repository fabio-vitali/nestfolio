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

// Mirror rows are Projection<'P1'> in DWC — projectVersioned only.
projectVersioned('LedgerSnapshot', { a: 1 }, { version: 1 });
projectVersioned('InvestorProfileSnapshot', { a: 1 }, { version: 1 });
projectVersioned('MarketSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error LedgerSnapshot is P1 in DWC — update() is forbidden
update('LedgerSnapshot', { a: 1 });
// @ts-expect-error InvestorProfileSnapshot is P1 in DWC — update() is forbidden
update('InvestorProfileSnapshot', { a: 1 });
// @ts-expect-error MarketSnapshot is P1 in DWC's mirror — update() is forbidden
update('MarketSnapshot', { a: 1 });

export {};
