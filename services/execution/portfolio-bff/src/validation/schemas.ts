import { z } from 'zod';

export const CurrencySchema = z.string().min(3).max(3).regex(/^[A-Z]{3}$/).default('USD');

export const PerformancePeriodSchema = z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'YTD', 'ALL']).default('MONTH');
