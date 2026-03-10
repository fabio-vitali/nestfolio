import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

export class TimeTravelAvailabilityPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: DashboardRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as Record<string, unknown>;

    const snapshotAt = (payload.snapshotAt as string) ?? event.timestamp;

    await this.repository.upsertTimeTravelAvailability(tenantId, snapshotAt);

    logger.info('Updated time-travel availability projection', {
      tenantId,
      eventType: event.type,
    });
  }
}
