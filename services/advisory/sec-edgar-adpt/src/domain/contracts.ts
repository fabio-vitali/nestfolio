import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/**
 * SecFiling subject — the `SecFiling` row (pk=`SecFiling#${cik}`, sk=`Filing#${accessionNumber}`),
 * CDC-emitted (field-mapped on formType) as SEC_8K_FILED / SEC_PROSPECTUS_UPDATED / SEC_10K_UPDATED.
 * Global — no tenant/region. project() injects pk/sk/__typename, so the subject is fields-only.
 */
export const SecFilingSchema = z.object({
  cik: z.string(),
  issuer: z.string(),
  formType: z.string(),
  filingDate: z.string(),
  accessionNumber: z.string(),
  body: z.string(),
  source: z.literal('sec-edgar'),
  fetchedAt: z.string(),
});

export type SecFiling = z.infer<typeof SecFilingSchema>;

/** Inbound fetch trigger — empty subject (fetch-trigger.ts emits subject:{}). */
export const FetchRequestedSchema = z.object({});

export const secEdgarAdptEventSubjects = {
  FETCH_SEC_EDGAR_REQUESTED: FetchRequestedSchema,
  SEC_8K_FILED: SecFilingSchema,
  SEC_PROSPECTUS_UPDATED: SecFilingSchema,
  SEC_10K_UPDATED: SecFilingSchema,
} as const satisfies Record<string, ZodTypeAny>;
