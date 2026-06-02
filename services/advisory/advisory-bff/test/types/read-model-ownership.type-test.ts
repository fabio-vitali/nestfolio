/**
 * Compile-time proof that advisory-bff's ownership registration (workstream 3)
 * rejects the wrong write intents. A `@ts-expect-error` that does NOT error is
 * itself a compile failure. Verified by `nx run advisory-bff:typecheck`
 * (tsconfig.type-test.json) — no runtime assertions.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// DecisionReadModel is P1 — projectVersioned is the only blessed write.
projectVersioned('DecisionReadModel', { a: 1 }, { version: 1 });
// AdvisoryStatus is a P3 derived aggregate — also written via projectVersioned.
projectVersioned('AdvisoryStatus', { a: 1 }, { version: 1 });

// @ts-expect-error — unconditional project on the P1 DecisionReadModel must not typecheck
project('DecisionReadModel', { a: 1 });
// @ts-expect-error — accumulate on the P1 DecisionReadModel must not typecheck
accumulate('DecisionReadModel', { field: 'count', increment: 1 });
// @ts-expect-error — command update on the P1 DecisionReadModel must not typecheck
update('DecisionReadModel', { a: 1 });
// @ts-expect-error — record (append) on the P1 DecisionReadModel must not typecheck
record('DecisionReadModel', { a: 1 });

// The prior two-writer race wrote AdvisoryStatus via accumulate(); that path is
// now a compile error — exactly the regression this workstream removes.
// @ts-expect-error — accumulate on the P3 AdvisoryStatus must not typecheck
accumulate('AdvisoryStatus', { field: 'inFlightCount', increment: 1 });
// @ts-expect-error — record on the P3 AdvisoryStatus must not typecheck
record('AdvisoryStatus', { a: 1 });
// @ts-expect-error — command update on the P3 AdvisoryStatus must not typecheck
update('AdvisoryStatus', { a: 1 });


// User command rows (AppSync fn.js writes; CommandOwned). projectVersioned is rejected.
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
