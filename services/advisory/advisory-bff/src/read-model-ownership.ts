/**
 * advisory-bff read-model ownership registration.
 *
 * Compile-time enforcement:
 *   - DecisionReadModel : P1 → projectVersioned only (record/update/accumulate fail typecheck).
 *   - AdvisoryStatus    : CommandOwned → advisory-bff's OWN derived aggregate,
 *     recomputed + self-versioned via update(..., { add: { __version: 1 } }).
 *     projectVersioned on it no longer compiles (that is the point). dashboard-bff
 *     holds the consumer-side Projection<'P3'> copy of the announced aggregate.
 *   - UserConfirmation / UserRejection / UserInteraction : CommandOwned (AppSync fn.js writes).
 */
import type { Projection, CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionReadModel: Projection<'P1'>;
    AdvisoryStatus: CommandOwned;
    UserConfirmation: CommandOwned;
    UserRejection: CommandOwned;
    UserInteraction: CommandOwned;
  }
}

export {};
