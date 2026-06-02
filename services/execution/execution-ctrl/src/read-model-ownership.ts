/**
 * execution-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - Order / StagedOrder : CommandOwned mutable aggregates (created via
 *     record(); status mutated/deleted by StagedOrderProcessor) →
 *     projectVersioned fails typecheck.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    Order: CommandOwned;
    StagedOrder: CommandOwned;
  }
}

export {};
