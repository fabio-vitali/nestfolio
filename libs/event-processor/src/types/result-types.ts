export type RecordOutcome = 'success' | 'deduplicated' | 'error' | 'poison-pill' | 'skipped';

export interface RecordResult {
  readonly messageId: string;
  readonly outcome: RecordOutcome;
  readonly error?: Error;
  readonly retryable?: boolean;
}

export interface IntentResult {
  readonly _tag: string;
  readonly success: boolean;
  readonly deduplicated?: boolean;
}

export interface BatchResult {
  readonly results: RecordResult[];
  readonly metrics: Record<string, number>;
  readonly batchItemFailures: string[];
}
