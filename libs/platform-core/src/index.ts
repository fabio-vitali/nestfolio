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
  handleErrors,
  type ErrorEvent,
} from './errors';
export { log, logger } from './logger';
export { tracer } from './tracer';
export { type TableEntry } from './table';
export { validateIncomingEvent, withSchemaValidation, type ValidationResult } from './validation';
export { TableRepository } from './repositories/table.repository';
export { EventRepository } from './repositories/event.repository';
export { BucketRepository } from './repositories/bucket.repository';
