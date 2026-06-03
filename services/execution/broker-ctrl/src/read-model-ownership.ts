/**
 * broker-ctrl read-model ownership registration (WS-D).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ExecutionMode : CommandOwned single-field operating-mode cache, seeded /
 *     refreshed via record() on EXECUTION_MODE_CHANGED. Read by the order
 *     state-machine's ReadExecutionMode GetItem (read-your-own-writes). No
 *     __version — add one only if a P1 consumer of the cache is introduced.
 *     projectVersioned() on it must fail typecheck.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ExecutionMode: CommandOwned;
  }
}

export {};
