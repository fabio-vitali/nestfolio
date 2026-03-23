const mockChangeDataCapture = jest.fn().mockReturnValue(jest.fn());

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  changeDataCapture: mockChangeDataCapture,
}));

import { buildEventTypeMap } from '@nestfolio/event-processor';
import { MarketwatchEntityTypes } from '../../src/domain/events';

describe('marketwatch-adpt event-publisher (CDC)', () => {
  it('MarketwatchEntityTypes contains MarketWatchArticle', () => {
    expect(MarketwatchEntityTypes).toContain('MarketWatchArticle');
  });

  it('buildEventTypeMap produces INSERT/MODIFY entries for MarketWatchArticle', () => {
    const map = buildEventTypeMap([...MarketwatchEntityTypes]);

    expect(map).toHaveProperty('MarketWatchArticle:INSERT');
    expect(map).toHaveProperty('MarketWatchArticle:MODIFY');
  });

  it('buildEventTypeMap generates INSERT and MODIFY keys for all entity types', () => {
    const map = buildEventTypeMap([...MarketwatchEntityTypes]);

    for (const typeName of MarketwatchEntityTypes) {
      expect(map).toHaveProperty(`${typeName}:INSERT`);
      expect(map).toHaveProperty(`${typeName}:MODIFY`);
    }
  });

  it('handler is exported and is a function', async () => {
    const { handler } = await import('../../src/handlers/event-publisher');
    expect(typeof handler).toBe('function');
  });

  it('changeDataCapture is called with marketwatch-adpt serviceName', async () => {
    await import('../../src/handlers/event-publisher');
    expect(mockChangeDataCapture).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'marketwatch-adpt' }),
    );
  });

  it('changeDataCapture is called with eventTypeMap covering INSERT/MODIFY for all entity types', async () => {
    await import('../../src/handlers/event-publisher');
    const callArg = mockChangeDataCapture.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    for (const typeName of MarketwatchEntityTypes) {
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:INSERT`);
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:MODIFY`);
    }
  });
});
