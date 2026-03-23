const mockChangeDataCapture = jest.fn().mockReturnValue(jest.fn());

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  changeDataCapture: mockChangeDataCapture,
}));

import { buildEventTypeMap } from '@nestfolio/event-processor';
import { SecEdgarEntityTypes, SecEdgarAdptEventTypes } from '../src/domain/events';
import type { StreamRecord } from '@nestfolio/event-processor';

describe('sec-edgar-adpt event-publisher (CDC)', () => {
  it('SecEdgarEntityTypes contains SecFiling', () => {
    expect(SecEdgarEntityTypes).toContain('SecFiling');
  });

  it('buildEventTypeMap produces INSERT/MODIFY entries for SecFiling', () => {
    const map = buildEventTypeMap([...SecEdgarEntityTypes]);
    expect(map).toHaveProperty('SecFiling:INSERT');
    expect(map).toHaveProperty('SecFiling:MODIFY');
  });

  it('handler is exported and is a function', async () => {
    const { handler } = await import('../src/handlers/event-publisher');
    expect(typeof handler).toBe('function');
  });

  it('changeDataCapture is called with sec-edgar-adpt serviceName', async () => {
    await import('../src/handlers/event-publisher');
    expect(mockChangeDataCapture).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'sec-edgar-adpt' }),
    );
  });

  it('changeDataCapture is called with eventTypeMap covering INSERT/MODIFY for SecFiling', async () => {
    await import('../src/handlers/event-publisher');
    const callArg = mockChangeDataCapture.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(callArg.eventTypeMap).toHaveProperty('SecFiling:INSERT');
    expect(callArg.eventTypeMap).toHaveProperty('SecFiling:MODIFY');
  });

  describe('form-type-based event routing via eventTypeMap resolvers', () => {
    function makeStreamRecord(formType: string): StreamRecord {
      return {
        __typename: 'SecFiling',
        pk: 'SecFiling#0000102909',
        sk: `Filing#acc-${formType}`,
        tenantId: 'SYSTEM',
        formType,
        cik: '0000102909',
        issuer: 'Vanguard',
        filingDate: '2026-03-17',
        accessionNumber: `acc-${formType}`,
        body: '',
        source: 'sec-edgar',
        fetchedAt: new Date().toISOString(),
        eventName: 'INSERT',
      } as unknown as StreamRecord;
    }

    function getResolver(): (record: StreamRecord) => string {
      const callArg = mockChangeDataCapture.mock.calls[0]?.[0];
      const resolver = callArg?.eventTypeMap?.['SecFiling:INSERT'];
      if (typeof resolver !== 'function') throw new Error('Resolver is not a function');
      return resolver;
    }

    beforeEach(async () => {
      mockChangeDataCapture.mockClear();
      jest.resetModules();
      // Re-mock after resetModules
      jest.mock('@nestfolio/event-processor', () => ({
        ...jest.requireActual('@nestfolio/event-processor'),
        changeDataCapture: mockChangeDataCapture,
      }));
      await import('../src/handlers/event-publisher');
    });

    it('routes 8-K → SEC_8K_FILED', () => {
      const resolver = getResolver();
      expect(resolver(makeStreamRecord('8-K'))).toBe(SecEdgarAdptEventTypes.SEC_8K_FILED);
    });

    it('routes 485BPOS → SEC_PROSPECTUS_UPDATED', () => {
      const resolver = getResolver();
      expect(resolver(makeStreamRecord('485BPOS'))).toBe(SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED);
    });

    it('routes N-1A → SEC_PROSPECTUS_UPDATED', () => {
      const resolver = getResolver();
      expect(resolver(makeStreamRecord('N-1A'))).toBe(SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED);
    });

    it('routes 10-K → SEC_10K_UPDATED', () => {
      const resolver = getResolver();
      expect(resolver(makeStreamRecord('10-K'))).toBe(SecEdgarAdptEventTypes.SEC_10K_UPDATED);
    });

    it('routes 10-Q → SEC_10K_UPDATED', () => {
      const resolver = getResolver();
      expect(resolver(makeStreamRecord('10-Q'))).toBe(SecEdgarAdptEventTypes.SEC_10K_UPDATED);
    });

    it('falls back to SEC_8K_FILED for unknown form type', () => {
      const resolver = getResolver();
      expect(resolver(makeStreamRecord('UNKNOWN'))).toBe(SecEdgarAdptEventTypes.SEC_8K_FILED);
    });
  });
});
