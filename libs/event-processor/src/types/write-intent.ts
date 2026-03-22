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
  readonly condition?: string;
  readonly overrides?: KeyOverrides;
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

export type WriteIntent = RecordIntent | ProjectIntent | AccumulateIntent | UpdateIntent | StoreIntent | SkipIntent;
