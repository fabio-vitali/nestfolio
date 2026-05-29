/**
 * Type-level tests. Validated by `pnpm nx run event-processor:typecheck`
 * (tsc --noEmit). No runtime assertions — a `@ts-expect-error` that does NOT
 * error is a compile failure, which is the test failing.
 */
import { accumulate, project, record, update, updateOrRetry, projectVersioned } from '../../src';
import type { Projection, CommandOwned } from '../../src';

// --- empty-registry baseline: everything compiles as plain string ---
accumulate('AnyUnregistered', { field: 'count', increment: 1 });
project('AnyUnregistered', { a: 1 });
record('AnyUnregistered', { a: 1 });
update('AnyUnregistered', { a: 1 });
updateOrRetry('AnyUnregistered', { a: 1 }, { condition: 'attribute_exists(pk)' });
projectVersioned('AnyUnregistered', { a: 1 }, { version: 1 });

// --- local augmentation turns on enforcement for these typenames ---
declare module '../../src' {
  interface ReadModelOwnership {
    TestP1: Projection<'P1'>;
    TestP2: Projection<'P2'>;
    TestCmd: CommandOwned;
  }
}

// P1 projection: projectVersioned ok; the footguns are rejected.
projectVersioned('TestP1', { a: 1 }, { version: 1 });
// @ts-expect-error — accumulate on a projection must not typecheck
accumulate('TestP1', { field: 'count', increment: 1 });
// @ts-expect-error — unconditional project on a P1 projection must not typecheck
project('TestP1', { a: 1 });
// @ts-expect-error — command update on a projection must not typecheck
update('TestP1', { a: 1 });
// @ts-expect-error — record (append) on a P1 projection must not typecheck
record('TestP1', { a: 1 });

// P2 append log: record ok; projectVersioned rejected.
record('TestP2', { a: 1 });
// @ts-expect-error — projectVersioned on a P2 projection must not typecheck
projectVersioned('TestP2', { a: 1 }, { version: 1 });

// command-owned is a valid record() target (seed-by-one-idempotent-event) and accumulate() target
record('TestCmd', { a: 1 });
accumulate('TestCmd', { field: 'count', increment: 1 });

// Command-owned: update ok; projectVersioned rejected.
update('TestCmd', { a: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('TestCmd', { a: 1 }, { version: 1 });
