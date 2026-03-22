import { toUow } from '../../src/util/to-uow';
import type { EventPayload } from '../../src/types/handler-config';
import type { EventContext } from '../../src/types/event-context';

describe('toUow', () => {
  const ctx = {
    eventId: 'e1', eventType: 'TEST', tenantId: 't1',
    timestamp: '2026-01-01T00:00:00.000Z', receiveCount: 1, serviceName: 'test',
    record: {} as any,
  } as EventContext;

  it('should build UoW from payload and context', () => {
    const payload: EventPayload = { subject: { foo: 'bar' }, context: { tenantId: 't1' } };
    const uow = toUow(payload, ctx);
    expect(uow.event.id).toBe('e1');
    expect(uow.event.type).toBe('TEST');
    expect(uow.event.subject).toEqual({ foo: 'bar' });
    expect(uow.payload).toEqual({ foo: 'bar' });
  });

  it('should default context.tenantId from ctx when payload.context missing', () => {
    const payload: EventPayload = { subject: { foo: 'bar' } };
    const uow = toUow(payload, ctx);
    expect(uow.event.context).toEqual({ tenantId: 't1' });
  });
});
