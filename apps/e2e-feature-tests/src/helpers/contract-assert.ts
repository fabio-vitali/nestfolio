import type { ZodTypeAny, z } from 'zod';

/**
 * Validate a REAL persisted producer row against its producer contract.
 * The CDC publisher emits the whole row as the event subject, so a row that
 * parses IS proof the emitted subject satisfies the contract (declared fields
 * present + correctly typed; zod strips identity/keys). Returns the parsed
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
