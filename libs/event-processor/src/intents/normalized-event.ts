import type { RecordIntent, KeyOverrides } from '../types/write-intent';
import type { RequestContext } from '../domain/schemas';

/**
 * Type-safe intent for writing NormalizedEvent records.
 *
 * NormalizedEvent records are consumed by the CDC passthrough pipeline, which
 * reads `tenantId`, `userId`, and `region` from the DDB record and puts them
 * into the EventBridge event `context`. Downstream Ingress pipelines validate
 * all three fields via `RequestContextSchema`.
 *
 * This helper enforces that all RequestContext fields are present at compile
 * time — preventing "Invalid event: missing context.X" runtime errors.
 */
export function normalizedEvent(
  fields: RequestContext & { timestamp: string } & Record<string, unknown>,
  overrides: KeyOverrides,
): RecordIntent {
  return {
    _tag: 'record',
    typename: 'NormalizedEvent',
    fields: { __typename: 'NormalizedEvent', ...fields },
    overrides,
  };
}
