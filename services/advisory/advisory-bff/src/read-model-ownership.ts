/**
 * advisory-bff read-model ownership registration (workstream 3).
 *
 * Compile-time enforcement:
 *   - DecisionReadModel : P1 → projectVersioned only (record/update/accumulate fail typecheck).
 *   - AdvisoryStatus    : P3 derived aggregate → projectVersioned only; the prior
 *     accumulate('AdvisoryStatus') no longer compiles (that is the point).
 */
import type { Projection, CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionReadModel: Projection<'P1'>;
    AdvisoryStatus: Projection<'P3'>;
    // CommandOwned — user command rows written by AppSync fn.js PutItems.
    UserConfirmation: CommandOwned;
    UserRejection: CommandOwned;
    UserInteraction: CommandOwned;
  }
}

export {};
