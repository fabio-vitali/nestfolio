import { SecFilingSchema } from '../../../src/domain/contracts';

describe('SecFilingSchema', () => {
  const validFiling = {
    cik: '0000102909',
    issuer: 'Vanguard Group Inc',
    formType: '8-K',
    filingDate: '2026-06-10',
    accessionNumber: '0000102909-26-000001',
    body: '<html><body><h1>Mock SEC Filing Document</h1></body></html>',
    source: 'sec-edgar' as const,
    fetchedAt: '2026-06-10T12:00:00.000Z',
  };

  it('parses a real filing fields object', () => {
    const result = SecFilingSchema.parse(validFiling);
    expect(result.formType).toBe('8-K');
    expect(result.cik).toBe('0000102909');
    expect(result.source).toBe('sec-edgar');
  });

  it('rejects a missing required field', () => {
    const { cik: _, ...noCik } = validFiling;
    expect(() => SecFilingSchema.parse(noCik)).toThrow();
  });

  it('rejects a wrong source literal', () => {
    expect(() =>
      SecFilingSchema.parse({ ...validFiling, source: 'other-source' }),
    ).toThrow();
  });

  it('strips pk/sk/__typename when present (fields-only contract)', () => {
    // project() injects the envelope (pk/sk/__typename) downstream — the contract is fields-only.
    // Default zod strips unknown keys, so an input carrying the envelope yields a fields-only row.
    const result = SecFilingSchema.parse({
      ...validFiling,
      pk: 'SecFiling#0000102909',
      sk: 'Filing#0000102909-26-000001',
      __typename: 'SecFiling',
    });
    expect('pk' in result).toBe(false);
    expect('sk' in result).toBe(false);
    expect('__typename' in result).toBe(false);
    // fields are retained
    expect(result.cik).toBe('0000102909');
  });
});
