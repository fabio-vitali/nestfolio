const mockChangeDataCapture = jest.fn().mockReturnValue(jest.fn());

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  changeDataCapture: mockChangeDataCapture,
}));

import { buildEventTypeMap } from '@nestfolio/event-processor';
import { AlphaVantageEntityTypes } from '../../src/domain/events';

describe('alpha-vantage-adpt event-publisher (CDC)', () => {
  it('AlphaVantageEntityTypes contains expected entity type names', () => {
    expect(AlphaVantageEntityTypes).toContain('AlphaVantageArticle');
    expect(AlphaVantageEntityTypes).toContain('EconomicIndicator');
  });

  it('buildEventTypeMap produces INSERT/MODIFY entries for all entity types', () => {
    const map = buildEventTypeMap([...AlphaVantageEntityTypes]);

    expect(map).toHaveProperty('AlphaVantageArticle:INSERT');
    expect(map).toHaveProperty('EconomicIndicator:INSERT');
  });

  it('buildEventTypeMap generates INSERT and MODIFY keys per entity type', () => {
    const map = buildEventTypeMap([...AlphaVantageEntityTypes]);

    for (const typeName of AlphaVantageEntityTypes) {
      expect(map).toHaveProperty(`${typeName}:INSERT`);
      expect(map).toHaveProperty(`${typeName}:MODIFY`);
    }
  });

  it('handler is exported and is a function', async () => {
    const { handler } = await import('../../src/handlers/event-publisher');
    expect(typeof handler).toBe('function');
  });

  it('changeDataCapture is called with alpha-vantage-adpt serviceName', async () => {
    await import('../../src/handlers/event-publisher');
    expect(mockChangeDataCapture).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'alpha-vantage-adpt' }),
    );
  });

  it('changeDataCapture is called with eventTypeMap covering INSERT/MODIFY for all entity types', async () => {
    await import('../../src/handlers/event-publisher');
    const callArg = mockChangeDataCapture.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    for (const typeName of AlphaVantageEntityTypes) {
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:INSERT`);
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:MODIFY`);
    }
  });
});
