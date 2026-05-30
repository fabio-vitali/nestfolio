/**
 * advisory-bff read-model ownership registration (workstream 3).
 *
 * Compile-time enforcement:
 *   - DecisionReadModel : P1 → projectVersioned only (record/update/accumulate fail typecheck).
 *   - AdvisoryStatus    : P3 derived aggregate → projectVersioned only; the prior
 *     accumulate('AdvisoryStatus') no longer compiles (that is the point).
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionReadModel: Projection<'P1'>;
    AdvisoryStatus: Projection<'P3'>;
  }
}

export {};
