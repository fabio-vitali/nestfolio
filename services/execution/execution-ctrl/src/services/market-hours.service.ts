import { logger } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

/**
 * Simple market hours checker for US stock market.
 * Phase 2: No holiday calendar — only checks day-of-week and time.
 */
export class MarketHoursService {
  private readonly log = withMethodLogging('MarketHoursService');

  readonly isMarketOpen = this.log('isMarketOpen',
    async (): Promise<boolean> => {
      const now = new Date();
      const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const day = etTime.getDay();
      const hours = etTime.getHours();
      const minutes = etTime.getMinutes();
      const timeInMinutes = hours * 60 + minutes;

      // Market open: Mon-Fri, 9:30 AM - 4:00 PM ET
      const isWeekday = day >= 1 && day <= 5;
      const isMarketHours = timeInMinutes >= 570 && timeInMinutes < 960; // 9:30=570, 16:00=960

      const open = isWeekday && isMarketHours;
      logger.info('Market hours check', { day, hours, minutes, isWeekday, isMarketHours, open });
      return open;
    },
  );

  readonly getNextMarketOpen = this.log('getNextMarketOpen',
    async (): Promise<string> => {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const day = et.getDay();
      const hours = et.getHours();
      const minutes = et.getMinutes();
      const timeInMinutes = hours * 60 + minutes;

      let daysUntilOpen = 0;

      if (day >= 1 && day <= 5 && timeInMinutes < 570) {
        // Weekday before market open — opens today
        daysUntilOpen = 0;
      } else if (day === 5 && timeInMinutes >= 960) {
        // Friday after close — next Monday
        daysUntilOpen = 3;
      } else if (day === 6) {
        // Saturday — next Monday
        daysUntilOpen = 2;
      } else if (day === 0) {
        // Sunday — next Monday
        daysUntilOpen = 1;
      } else if (day >= 1 && day <= 4 && timeInMinutes >= 960) {
        // Weekday after close — next day
        daysUntilOpen = 1;
      }

      const nextOpen = new Date(et);
      nextOpen.setDate(nextOpen.getDate() + daysUntilOpen);
      nextOpen.setHours(9, 30, 0, 0);

      return nextOpen.toISOString();
    },
  );
}
