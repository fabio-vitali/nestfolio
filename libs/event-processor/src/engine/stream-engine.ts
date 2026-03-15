import type { DynamoDBStreamEvent } from 'aws-lambda';
import { isRetryable } from '@nestfolio/lambda-utils';
import { logger } from '@nestfolio/platform-core';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { unmarshalStream } from '../util/unmarshal-stream';
import { StreamCollector } from './stream-collector';
import { ErrorEventPublisher } from './error-event-publisher';
import { asyncPool } from '../util/async-pool';
import { groupBy as groupByUtil } from '../util/group-by';

const DEFAULT_CONCURRENCY = 3;

export class StreamBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamBatchError';
  }
}

export interface StreamEngineConfig {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';
  };
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  concurrency?: number;
  busName?: string;
  errorEventType?: string;
}

export class StreamEngine {
  private readonly config: StreamEngineConfig;
  private readonly errorPublisher?: ErrorEventPublisher;

  constructor(config: StreamEngineConfig) {
    this.config = config;
    if (config.busName) {
      this.errorPublisher = new ErrorEventPublisher(config.busName, config.serviceName);
    }
  }

  async process(event: DynamoDBStreamEvent): Promise<void> {
    const startedAt = Date.now();
    const collector = new StreamCollector();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;

    // 1. Unmarshal
    const parsed: Array<{ streamRecord: StreamRecord; ctx: StreamContext }> = [];
    for (const ddbRecord of event.Records) {
      const result = unmarshalStream(ddbRecord, this.config.serviceName);
      if (!result) {
        logger.warn('Skipping record with no image', { eventID: ddbRecord.eventID });
        continue;
      }
      parsed.push(result);
    }

    // 2. Filter
    const filtered = this.config.filter
      ? parsed.filter((p) => this.config.filter!(p.streamRecord))
      : parsed;

    // 3. Process — per-record or per-group
    if (this.config.groupBy && this.config.processGroup) {
      const pick = this.config.groupBy.pick ?? 'all';

      if (pick === 'all') {
        const groups = groupByUtil(
          filtered,
          { key: (p) => this.config.groupBy!.key(p.streamRecord), pick: 'all' },
        );

        await asyncPool(
          Array.from(groups.entries()),
          async ([groupKey, items]) => {
            const ctx = items[0].ctx;
            const streamRecords = items.map((r) => r.streamRecord);
            try {
              await this.config.processGroup!(groupKey, streamRecords, ctx);
              collector.recordSuccess(groupKey);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              collector.recordError(groupKey, err, isRetryable(err), streamRecords);
            }
          },
          { concurrency },
        );
      } else {
        const groups = groupByUtil(
          filtered,
          { key: (p) => this.config.groupBy!.key(p.streamRecord), pick },
        );

        await asyncPool(
          Array.from(groups.entries()),
          async ([groupKey, item]) => {
            const ctx = item.ctx;
            const streamRecords = [item.streamRecord];
            try {
              await this.config.processGroup!(groupKey, streamRecords, ctx);
              collector.recordSuccess(groupKey);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              collector.recordError(groupKey, err, isRetryable(err), streamRecords);
            }
          },
          { concurrency },
        );
      }
    } else if (this.config.processRecord) {
      await asyncPool(
        filtered,
        async ({ streamRecord, ctx }) => {
          try {
            await this.config.processRecord!(streamRecord, ctx);
            collector.recordSuccess(ctx.record.eventID ?? 'unknown');
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            collector.recordError(
              ctx.record.eventID ?? 'unknown',
              err,
              isRetryable(err),
              streamRecord,
            );
          }
        },
        { concurrency },
      );
    }

    // 4. Post-batch: publish non-retryable errors
    const nonRetryable = collector.getNonRetryableForPublishing();
    if (nonRetryable.length > 0 && this.errorPublisher) {
      const errorType = this.config.errorEventType
        ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_STREAM_FAILED`;
      await this.errorPublisher.publishErrors(nonRetryable, errorType);
    }

    // 5. Metrics
    collector.setBatchDuration(Date.now() - startedAt);

    // 6. Throw if retryable errors exist
    if (collector.hasRetryableErrors()) {
      const retryCount = collector.getErrors().retryable.length;
      throw new StreamBatchError(
        `StreamBatchError: ${retryCount} retryable error(s) in stream batch — DDB Stream will retry`,
      );
    }
  }
}
