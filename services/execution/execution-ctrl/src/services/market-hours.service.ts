import { logger } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

const US_MARKET_HOLIDAYS: Record<number, string[]> = {
  2024: [
    '2024-01-15', // MLK Day
    '2024-02-19', // Presidents Day
    '2024-03-29', // Good Friday
    '2024-05-27', // Memorial Day
    '2024-06-19', // Juneteenth
    '2024-07-04', // Independence Day
    '2024-09-02', // Labor Day
    '2024-11-28', // Thanksgiving
    '2024-12-25', // Christmas
  ],
  2025: [
    '2025-01-20', // MLK Day
    '2025-02-17', // Presidents Day
    '2025-04-18', // Good Friday
    '2025-05-26', // Memorial Day
    '2025-06-19', // Juneteenth
    '2025-07-04', // Independence Day
    '2025-09-01', // Labor Day
    '2025-11-27', // Thanksgiving
    '2025-12-25', // Christmas
  ],
  2026: [
    '2026-01-19', // MLK Day
    '2026-02-16', // Presidents Day
    '2026-04-03', // Good Friday
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-03', // Independence Day (observed)
    '2026-09-07', // Labor Day
    '2026-11-26', // Thanksgiving
    '2026-12-25', // Christmas
  ],
  2027: [
    '2027-01-18', // MLK Day
    '2027-02-15', // Presidents Day
    '2027-03-26', // Good Friday
    '2027-05-31', // Memorial Day
    '2027-06-18', // Juneteenth (observed)
    '2027-07-05', // Independence Day (observed)
    '2027-09-06', // Labor Day
    '2027-11-25', // Thanksgiving
    '2027-12-24', // Christmas (observed)
  ],
};

const EARLY_CLOSE_DATES: Record<number, string[]> = {
  2024: ['2024-11-29', '2024-12-24'],
  2025: ['2025-11-28', '2025-12-24'],
  2026: ['2026-11-27', '2026-12-24'],
  2027: ['2027-11-26', '2027-12-23'],
};

/** Formats a Date using local (ET-adjusted) components, not UTC */
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isHoliday(date: Date): boolean {
  const year = date.getFullYear();
  const holidays = US_MARKET_HOLIDAYS[year];
  if (!holidays) {
    logger.warn('No holiday calendar for year', { year });
    return false;
  }
  return holidays.includes(toDateString(date));
}

function isEarlyClose(date: Date): boolean {
  const year = date.getFullYear();
  const dates = EARLY_CLOSE_DATES[year];
  if (!dates) {
    logger.warn('No early close calendar for year', { year });
    return false;
  }
  return dates.includes(toDateString(date));
}

/**
 * Market hours checker for US stock market with holiday calendar.
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

      const isWeekday = day >= 1 && day <= 5;
      if (!isWeekday) return false;

      const holiday = isHoliday(etTime);
      if (holiday) return false;

      const closeTime = isEarlyClose(etTime) ? 780 : 960; // 1PM = 780, 4PM = 960
      const isMarketHours = timeInMinutes >= 570 && timeInMinutes < closeTime;

      logger.info('Market hours check', { day, hours, minutes, isWeekday, isMarketHours, isHoliday: holiday });
      return isMarketHours;
    },
  );

  readonly getNextMarketOpen = this.log('getNextMarketOpen',
    async (): Promise<string> => {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

      // Start from current time
      const candidate = new Date(et);

      // If market is currently open, return current time context
      const day = et.getDay();
      const timeInMinutes = et.getHours() * 60 + et.getMinutes();

      if (day >= 1 && day <= 5 && timeInMinutes < 570 && !isHoliday(et)) {
        // Weekday before open, not a holiday — opens today
        candidate.setHours(9, 30, 0, 0);
        return candidate.toISOString();
      }

      // Otherwise, find next valid trading day
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(9, 30, 0, 0);

      // Skip weekends and holidays (max 10 days look-ahead)
      for (let i = 0; i < 10; i++) {
        const d = candidate.getDay();
        if (d >= 1 && d <= 5 && !isHoliday(candidate)) {
          return candidate.toISOString();
        }
        candidate.setDate(candidate.getDate() + 1);
      }

      // Fallback
      return candidate.toISOString();
    },
  );
}
