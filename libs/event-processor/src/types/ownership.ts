/**
 * Row-ownership type tags + the declaration-merging registry that steers each
 * write intent to its allowed typenames at compile time. See
 * docs/architecture/READ-MODEL-OWNERSHIP.md for the model.
 *
 * The registry is EMPTY by default: every reject-helper below resolves to
 * `never`, so an empty registry rejects nothing and all `typename: string`
 * call sites compile unchanged. A service opts a typename into enforcement by
 * augmenting `ReadModelOwnership` via `declare module '@nestfolio/event-processor'`.
 */
export type ProjectionVariant = 'P1' | 'P2' | 'P3';

/** Aggregate this context owns: read-your-own-writes, field-level command writes. */
export interface CommandOwned {
  readonly __ownership: 'command';
}

/** Pure copy fed by an owner's versioned announcements. */
export interface Projection<V extends ProjectionVariant = ProjectionVariant> {
  readonly __ownership: 'projection';
  readonly __variant: V;
}

export type OwnershipTag = CommandOwned | Projection;

/**
 * Open registry — augmented per service:
 *   declare module '@nestfolio/event-processor' {
 *     interface ReadModelOwnership { PortfolioSummary: Projection<'P1'> }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface ReadModelOwnership {}

type OwnedKeys = keyof ReadModelOwnership;

type ProjectionKeysOf<V extends ProjectionVariant> = {
  [K in OwnedKeys]: ReadModelOwnership[K] extends Projection<V> ? K : never;
}[OwnedKeys];

/** Typenames registered as ANY projection variant. */
export type AnyProjectionKey = {
  [K in OwnedKeys]: ReadModelOwnership[K] extends Projection ? K : never;
}[OwnedKeys];

/** Typenames registered as command-owned. */
export type CommandOwnedKey = {
  [K in OwnedKeys]: ReadModelOwnership[K] extends CommandOwned ? K : never;
}[OwnedKeys];

export type P1Key = ProjectionKeysOf<'P1'>;
export type P2Key = ProjectionKeysOf<'P2'>;
export type P3Key = ProjectionKeysOf<'P3'>;

// --- factory constraints: reject known-bad, allow unregistered + ok ---

/** projectVersioned: only P1 (or unregistered). Reject command-owned / P2 / P3. */
export type RejectNonP1<K extends string> = K extends CommandOwnedKey | P2Key | P3Key ? never : K;

/** project / accumulate / update / updateOrRetry: reject ANY projection. */
export type RejectProjection<K extends string> = K extends AnyProjectionKey ? never : K;

/** record: reject P1 + P3 (P2 append-log is the legitimate record() target). */
export type RejectNonAppend<K extends string> = K extends P1Key | P3Key ? never : K;
