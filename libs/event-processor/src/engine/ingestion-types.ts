import type { BusEvent } from '../platform';

export interface IngestionRecord {
  readonly id: string;
  readonly event: BusEvent;
  readonly metadata: {
    readonly receiveCount?: number;
  };
}

export interface IngestionResult {
  readonly failures: string[];
  readonly metrics: Record<string, number>;
  readonly droppedErrors: Array<{ messageId: string; eventType: string; error: Error; causedBy?: unknown }>;
}

export interface IngestionAdapter<TEvent, TResponse> {
  toRecords(event: TEvent): IngestionRecord[];
  toResponse(result: IngestionResult): TResponse;
}
