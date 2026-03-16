// Core types
export { type Event, type Pipe, type UnitOfWork, envVar, getTime, getUUID } from './core';
export { type TableEntry } from './table';

// Bus
export { type BusEvent, type Bus, EventBridgeBus } from './bus';

// Errors (consolidates internal + platform)
export { NotRetryableError, isRetryable, handleClientError, type ErrorEvent } from './errors';

// Logger
export { log, logger } from './logger';

// Tracer (from internal)
export { tracer } from '../internal';

// Validation
export { validateIncomingEvent, type ValidationResult } from './validation';

// FP
export { pipe } from './fp/pipe';
export { type Result, ok, err, isOk, isErr, mapResult, flatMapResult, tryCatch } from './fp/result';

// Branded types
export { type TenantId, type UserId, type EventId, asTenantId, asUserId, asEventId } from './types/branded';

// Repositories
export { TableRepository } from './repositories/table.repository';
export { EventRepository } from './repositories/event.repository';
export { BucketRepository } from './repositories/bucket.repository';

// Market data
export {
  type Quote, type IndexData, type RateData, type MarketDataProvider,
  StaticMarketDataProvider, CachedMarketDataProvider, KNOWN_SYMBOLS,
} from './market-data';
