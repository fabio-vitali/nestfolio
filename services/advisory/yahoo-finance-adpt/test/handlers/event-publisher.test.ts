const mockChangeDataCapture = jest.fn().mockReturnValue(jest.fn());

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  changeDataCapture: mockChangeDataCapture,
}));

import { buildEventTypeMap } from '@nestfolio/event-processor';
import { YahooFinanceEntityTypes } from '../../src/domain/events';

describe('yahoo-finance-adpt event-publisher (CDC)', () => {
  it('YahooFinanceEntityTypes contains YahooFinanceArticle', () => {
    expect(YahooFinanceEntityTypes).toContain('YahooFinanceArticle');
  });

  it('buildEventTypeMap produces INSERT/MODIFY entries for YahooFinanceArticle', () => {
    const map = buildEventTypeMap([...YahooFinanceEntityTypes]);

    expect(map).toHaveProperty('YahooFinanceArticle:INSERT');
    expect(map).toHaveProperty('YahooFinanceArticle:MODIFY');
  });

  it('buildEventTypeMap generates INSERT and MODIFY keys for all entity types', () => {
    const map = buildEventTypeMap([...YahooFinanceEntityTypes]);

    for (const typeName of YahooFinanceEntityTypes) {
      expect(map).toHaveProperty(`${typeName}:INSERT`);
      expect(map).toHaveProperty(`${typeName}:MODIFY`);
    }
  });

  it('handler is exported and is a function', async () => {
    const { handler } = await import('../../src/handlers/event-publisher');
    expect(typeof handler).toBe('function');
  });

  it('changeDataCapture is called with yahoo-finance-adpt serviceName', async () => {
    await import('../../src/handlers/event-publisher');
    expect(mockChangeDataCapture).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'yahoo-finance-adpt' }),
    );
  });

  it('changeDataCapture is called with eventTypeMap covering INSERT/MODIFY for all entity types', async () => {
    await import('../../src/handlers/event-publisher');
    const callArg = mockChangeDataCapture.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    for (const typeName of YahooFinanceEntityTypes) {
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:INSERT`);
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:MODIFY`);
    }
  });
});
