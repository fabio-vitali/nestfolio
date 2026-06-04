/**
 * Compile-time proof that advisory-bff's ownership registration rejects the
 * wrong write intents. A `@ts-expect-error` that does NOT error is itself a
 * compile failure. Verified by `nx run advisory-bff:typecheck`
 * (tsconfig.type-test.json) — no runtime assertions.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// DecisionReadModel is P1 — projectVersioned is the only blessed write.
projectVersioned('DecisionReadModel', { a: 1 }, { version: 1 });

// AdvisoryStatus is advisory-bff's OWN command-owned derived aggregate, written
// with an atomic self-increment of __version via update() — the strictly-
// monotonic recompute fix (was projectVersioned + Date.now()).
update('AdvisoryStatus', { inFlightCount: 1 }, { add: { __version: 1 } });

// @ts-expect-error — unconditional project on the P1 DecisionReadModel must not typecheck
project('DecisionReadModel', { a: 1 });
// @ts-expect-error — accumulate on the P1 DecisionReadModel must not typecheck
accumulate('DecisionReadModel', { field: 'count', increment: 1 });
// @ts-expect-error — command update on the P1 DecisionReadModel must not typecheck
update('DecisionReadModel', { a: 1 });
// @ts-expect-error — record (append) on the P1 DecisionReadModel must not typecheck
record('DecisionReadModel', { a: 1 });

// AdvisoryStatus is CommandOwned — projectVersioned (P1-only) is now rejected.
// @ts-expect-error — projectVersioned on the command-owned AdvisoryStatus must not typecheck
projectVersioned('AdvisoryStatus', { a: 1 }, { version: 1 });

// User command rows (AppSync fn.js writes; CommandOwned). projectVersioned rejected.
record('UserConfirmation', { a: 1 });
record('UserRejection', { a: 1 });
record('UserInteraction', { a: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserConfirmation', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserRejection', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserInteraction', { a: 1 }, { version: 1 });

export {};
