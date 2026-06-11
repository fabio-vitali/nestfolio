import type { ZodTypeAny, z } from 'zod';

/**
 * Validate a REAL persisted producer row against its producer contract.
 * Under WS-2 the CDC publisher emits `schema.parse(row)` as the event subject
 * (the DRY subject — envelope/identity fields are dropped). A row that parses
 * here IS proof that the emitted subject is a well-formed instance of the
 * contract (declared fields present + correctly typed). Returns the parsed
 * aggregate for further field assertions.
 */
export function expectContractMatch<S extends ZodTypeAny>(
  schema: S,
  row: Record<string, unknown> | undefined,
  label: string,
): z.infer<S> {
  if (!row) throw new Error(`expectContractMatch(${label}): row was undefined`);
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new Error(
      `Contract drift for ${label}: ${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  return result.data;
}
