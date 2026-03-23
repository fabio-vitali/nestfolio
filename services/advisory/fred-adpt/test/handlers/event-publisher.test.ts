const mockChangeDataCapture = jest.fn().mockReturnValue(jest.fn());

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  changeDataCapture: mockChangeDataCapture,
}));

import { buildEventTypeMap } from '@nestfolio/event-processor';
import { FredEntityTypes } from '../../src/domain/events';

describe('fred-adpt event-publisher (CDC)', () => {
  it('FredEntityTypes contains FredIndicator', () => {
    expect(FredEntityTypes).toContain('FredIndicator');
  });

  it('buildEventTypeMap produces INSERT/MODIFY entries for FredIndicator', () => {
    const map = buildEventTypeMap([...FredEntityTypes]);

    expect(map).toHaveProperty('FredIndicator:INSERT');
    expect(map).toHaveProperty('FredIndicator:MODIFY');
  });

  it('buildEventTypeMap generates INSERT and MODIFY keys for all entity types', () => {
    const map = buildEventTypeMap([...FredEntityTypes]);

    for (const typeName of FredEntityTypes) {
      expect(map).toHaveProperty(`${typeName}:INSERT`);
      expect(map).toHaveProperty(`${typeName}:MODIFY`);
    }
  });

  it('handler is exported and is a function', async () => {
    const { handler } = await import('../../src/handlers/event-publisher');
    expect(typeof handler).toBe('function');
  });

  it('changeDataCapture is called with fred-adpt serviceName', async () => {
    await import('../../src/handlers/event-publisher');
    expect(mockChangeDataCapture).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'fred-adpt' }),
    );
  });

  it('changeDataCapture is called with eventTypeMap covering INSERT/MODIFY for all entity types', async () => {
    await import('../../src/handlers/event-publisher');
    const callArg = mockChangeDataCapture.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    for (const typeName of FredEntityTypes) {
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:INSERT`);
      expect(callArg.eventTypeMap).toHaveProperty(`${typeName}:MODIFY`);
    }
  });
});
