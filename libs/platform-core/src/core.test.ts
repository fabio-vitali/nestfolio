import { envVar, getTime, getUUID, type Event, type UnitOfWork } from './core';

describe('core', () => {
  describe('envVar', () => {
    it('should return the value of an existing environment variable', () => {
      process.env.TEST_VAR = 'test-value';
      expect(envVar('TEST_VAR')).toBe('test-value');
      delete process.env.TEST_VAR;
    });

    it('should throw if the environment variable is not set', () => {
      delete process.env.MISSING_VAR;
      expect(() => envVar('MISSING_VAR')).toThrow(
        'Required environment variable MISSING_VAR is not set',
      );
    });

    it('should throw if the environment variable is empty', () => {
      process.env.EMPTY_VAR = '';
      expect(() => envVar('EMPTY_VAR')).toThrow(
        'Required environment variable EMPTY_VAR is not set',
      );
      delete process.env.EMPTY_VAR;
    });
  });

  describe('getTime', () => {
    it('should return a valid ISO 8601 timestamp', () => {
      const time = getTime();
      expect(new Date(time).toISOString()).toBe(time);
    });
  });

  describe('getUUID', () => {
    it('should return a valid UUID v4 string', () => {
      const uuid = getUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('should return unique values on each call', () => {
      const a = getUUID();
      const b = getUUID();
      expect(a).not.toBe(b);
    });
  });

  describe('type safety', () => {
    it('should allow creating an Event', () => {
      const event: Event = { id: '1', type: 'TEST', timestamp: '2026-01-01T00:00:00.000Z' };
      expect(event.type).toBe('TEST');
    });

    it('should allow creating a UnitOfWork', () => {
      const uow: UnitOfWork = {
        event: { id: '1', type: 'TEST', timestamp: '2026-01-01T00:00:00.000Z' },
        payload: { key: 'value' },
        record: { raw: true },
      };
      expect(uow.payload['key']).toBe('value');
    });
  });
});
