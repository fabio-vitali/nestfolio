export interface KeyOverrides {
  readonly pk?: string;
  readonly sk?: string;
}

export interface RecordIntent {
  readonly _tag: 'record';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
}

export interface ProjectIntent {
  readonly _tag: 'project';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
}

export interface ProjectVersionedIntent {
  readonly _tag: 'projectVersioned';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  /** Monotonic version stamped on the owned row (reserved `__version` attribute). */
  readonly version: number;
  readonly overrides?: KeyOverrides;
}

export interface AccumulateIntent {
  readonly _tag: 'accumulate';
  readonly typename: string;
  readonly field: string;
  readonly increment: number;
  readonly ttl?: number;
  readonly overrides?: KeyOverrides;
}

export interface UpdateIntent {
  readonly _tag: 'update';
  readonly typename: string;
  readonly updates: Record<string, unknown>;
  readonly removes?: string[];
  /**
   * Fields to atomically increment using a DynamoDB ADD clause in the same
   * UpdateExpression as the SET, without a prior read. Keys are attribute
   * names; values are the numeric increment (typically 1). Use for monotonic
   * counters such as `__version` on a command-owned row.
   */
  readonly add?: Record<string, number>;
  readonly condition?: string;
  readonly conditionNames?: Record<string, string>;
  readonly conditionValues?: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
  /**
   * Behavior on ConditionalCheckFailedException when `condition` is set.
   * - 'skip' (default, also when undefined) — return
   *   `{ success: true, deduplicated: true }` so SQS treats the message
   *   as terminal. Use for dedup / skip-if-not-X patterns.
   * - 'retry' — re-throw so SQS redrives the message. Use for
   *   wait-until-X patterns where the precondition is expected to
   *   become true on a subsequent delivery (e.g., another event
   *   creates the row first). Set via the `updateOrRetry()` factory;
   *   never set directly via `update()` opts.
   */
  readonly onConditionFail?: 'skip' | 'retry';
}

export interface StoreIntent {
  readonly _tag: 'store';
  readonly body: unknown;
  readonly format?: 'json' | 'csv';
  readonly key?: string;
}

export interface SkipIntent {
  readonly _tag: 'skip';
}

export type WriteIntent = RecordIntent | ProjectIntent | ProjectVersionedIntent | AccumulateIntent | UpdateIntent | StoreIntent | SkipIntent;
