// @nestfolio/platform-core — Reusable event processing patterns
// Ported from @event-lab/event-processor, adapted for Nestfolio

export { type Event, type Pipe, type UnitOfWork, envVar, getTime, getUUID } from './core';
export {
  type BusEvent,
  type Bus,
  EventBridgeBus,
} from './bus';
export {
  NotRetryableError,
  isRetryable,
  handleClientError,
  type ErrorEvent,
} from './errors';
export { log, logger } from './logger';
export { tracer } from './tracer';
export { type TableEntry } from './table';
export { validateIncomingEvent, type ValidationResult } from './validation';
export { TableRepository } from './repositories/table.repository';
export { EventRepository } from './repositories/event.repository';
export { BucketRepository } from './repositories/bucket.repository';

// FP utilities
export { pipe } from './fp/pipe';
export { type Result, ok, err, isOk, isErr, mapResult, flatMapResult, tryCatch } from './fp/result';

// Branded types
export { type TenantId, type UserId, type EventId, asTenantId, asUserId, asEventId } from './types/branded';

// Market data
export {
  type Quote,
  type IndexData,
  type RateData,
  type MarketDataProvider,
  StaticMarketDataProvider,
  CachedMarketDataProvider,
  KNOWN_SYMBOLS,
} from './market-data';
