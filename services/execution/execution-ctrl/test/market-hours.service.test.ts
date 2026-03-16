jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { MarketHoursService } from '../src/services/market-hours.service';

describe('MarketHoursService', () => {
  let service: MarketHoursService;

  beforeEach(() => {
    service = new MarketHoursService();
    jest.restoreAllMocks();
  });

  describe('isMarketOpen', () => {
    it('should return true during market hours on a weekday', async () => {
      // Wednesday 10:00 AM ET = 15:00 UTC
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3); // Wednesday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-15T15:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(true);
    });

    it('should return false before market open on a weekday', async () => {
      // Wednesday 9:00 AM ET
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 9:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-15T14:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should return false after market close on a weekday', async () => {
      // Wednesday 4:30 PM ET
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 4:30:00 PM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(16);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-15T21:30:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should return false on Saturday', async () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/18/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(6);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-18T15:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should return false on Sunday', async () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/19/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-19T15:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should return true at exactly 9:30 AM ET', async () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 9:30:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-15T14:30:00.000Z');

      expect(await service.isMarketOpen()).toBe(true);
    });

    it('should return false at exactly 4:00 PM ET', async () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 4:00:00 PM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(16);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-01-15T21:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should report market as closed on a known holiday (MLK Day 2026)', async () => {
      // MLK Day 2026 = Monday Jan 19 at 10:00 AM ET
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/19/2026, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(1); // Monday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-19T15:00:00.000Z');

      const result = await service.isMarketOpen();
      expect(result).toBe(false);
    });

    it('should report market as closed on Christmas 2025', async () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('12/25/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(4); // Thursday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-12-25T15:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should report market as closed after 1PM on early close day', async () => {
      // Nov 28, 2025 (day after Thanksgiving) is an early close day
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('11/28/2025, 1:30:00 PM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(5); // Friday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(13);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-11-28T18:30:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should report market as open before 1PM on early close day', async () => {
      // Nov 28, 2025 (day after Thanksgiving) before 1PM
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('11/28/2025, 11:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(5); // Friday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(11);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-11-28T16:00:00.000Z');

      expect(await service.isMarketOpen()).toBe(true);
    });

    it('should use local date components, not UTC (near-midnight ET edge case)', async () => {
      // 11:30 PM ET on Jan 19 2026 (MLK holiday) = Jan 20 UTC
      // isHoliday should use ET date (Jan 19), not UTC date (Jan 20)
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/19/2026, 11:30:00 PM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(1); // Monday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(23);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
      jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(0); // January
      jest.spyOn(Date.prototype, 'getDate').mockReturnValue(19);
      // toISOString would return Jan 20 UTC — but we no longer use it for holiday check
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-20T04:30:00.000Z');

      expect(await service.isMarketOpen()).toBe(false);
    });

    it('should log warning for year with no holiday calendar (2028)', async () => {
      const { logger } = require('@nestfolio/event-processor');
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2028, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(6); // Saturday (simplest to get false)
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2028);
      jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getDate').mockReturnValue(15);

      // On a weekday with no calendar, should warn
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3); // Wednesday
      await service.isMarketOpen();

      expect(logger.warn).toHaveBeenCalledWith('No holiday calendar for year', { year: 2028 });
    });
  });

  describe('getNextMarketOpen', () => {
    it('should return a valid ISO string', async () => {
      const result = await service.getNextMarketOpen();
      expect(() => new Date(result)).not.toThrow();
      expect(new Date(result).toISOString()).toBeTruthy();
    });
  });
});
