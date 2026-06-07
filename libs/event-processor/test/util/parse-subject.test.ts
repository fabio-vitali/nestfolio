import { z } from 'zod';
import { parseSubject } from '../../src/util/parse-subject';

const Schema = z.object({
  cashBalanceCents: z.number(),
  note: z.string().optional(),
});

describe('parseSubject', () => {
  it('parses the subject from a UnitOfWork (uow.event.subject)', () => {
    const uow = {
      event: { id: '1', type: 'X', timestamp: 't', subject: { cashBalanceCents: 100 }, context: {} },
      payload: {},
      record: {},
    };
    expect(parseSubject(uow as never, Schema)).toEqual({ cashBalanceCents: 100 });
  });

  it('parses the subject from an EventPayload (payload.subject)', () => {
    const payload = { subject: { cashBalanceCents: 200 } };
    expect(parseSubject(payload, Schema)).toEqual({ cashBalanceCents: 200 });
  });

  it('strips unknown keys (non-strict) so additive producer fields stay compatible', () => {
    const payload = { subject: { cashBalanceCents: 1, extraNewField: 'ok' } };
    expect(parseSubject(payload, Schema)).toEqual({ cashBalanceCents: 1 });
  });

  it('throws ZodError on a contract violation (wrong type)', () => {
    const payload = { subject: { cashBalanceCents: 'not-a-number' } };
    expect(() => parseSubject(payload, Schema)).toThrow(z.ZodError);
  });

  it('throws when a required field is absent', () => {
    const payload = { subject: { note: 'hi' } };
    expect(() => parseSubject(payload, Schema)).toThrow(z.ZodError);
  });
});
