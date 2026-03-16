import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const PortfolioDriftDetectedSchema = BusEventSchema.extend({
  type: z.literal('PORTFOLIO_DRIFT_DETECTED'),
  subject: z.object({
    portfolioId: z.string(),
    driftPercent: z.number().min(0),
    threshold: z.number().min(0),
    driftDetails: z.array(
      z.object({
        symbol: z.string(),
        currentWeight: z.number(),
        targetWeight: z.number(),
        delta: z.number(),
      }),
    ),
  }),
});
export type PortfolioDriftDetectedEvent = z.infer<typeof PortfolioDriftDetectedSchema>;
