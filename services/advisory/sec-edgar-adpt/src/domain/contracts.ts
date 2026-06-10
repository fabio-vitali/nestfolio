import { z } from 'zod';

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
