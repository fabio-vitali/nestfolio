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

export interface S3PutIntent {
  readonly _tag: 's3-put';
  readonly body: unknown;
  readonly format: 'json' | 'csv';
  readonly key?: string;
}

export interface SkipIntent {
  readonly _tag: 'skip';
}

export type WriteIntent = RecordIntent | ProjectIntent | AccumulateIntent | S3PutIntent | SkipIntent;
