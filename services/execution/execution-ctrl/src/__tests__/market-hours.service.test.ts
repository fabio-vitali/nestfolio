jest.mock('@nestfolio/platform-core', () => ({
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { MarketHoursService } from '../services/market-hours.service';

describe('MarketHoursService', () => {
  let service: MarketHoursService;

  beforeEach(() => {
    service = new MarketHoursService();
    jest.restoreAllMocks();
  });

  describe('isMarketOpen', () => {
    it('should return true during market hours on a weekday', () => {
      // Wednesday 10:00 AM ET = 15:00 UTC
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3); // Wednesday
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      expect(service.isMarketOpen()).toBe(true);
    });

    it('should return false before market open on a weekday', () => {
      // Wednesday 9:00 AM ET
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 9:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      expect(service.isMarketOpen()).toBe(false);
    });

    it('should return false after market close on a weekday', () => {
      // Wednesday 4:30 PM ET
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 4:30:00 PM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(16);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);

      expect(service.isMarketOpen()).toBe(false);
    });

    it('should return false on Saturday', () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/18/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(6);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      expect(service.isMarketOpen()).toBe(false);
    });

    it('should return false on Sunday', () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/19/2025, 10:00:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(0);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      expect(service.isMarketOpen()).toBe(false);
    });

    it('should return true at exactly 9:30 AM ET', () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 9:30:00 AM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);

      expect(service.isMarketOpen()).toBe(true);
    });

    it('should return false at exactly 4:00 PM ET', () => {
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('1/15/2025, 4:00:00 PM');
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(16);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      expect(service.isMarketOpen()).toBe(false);
    });
  });

  describe('getNextMarketOpen', () => {
    it('should return a valid ISO string', () => {
      const result = service.getNextMarketOpen();
      expect(() => new Date(result)).not.toThrow();
      expect(new Date(result).toISOString()).toBeTruthy();
    });
  });
});
