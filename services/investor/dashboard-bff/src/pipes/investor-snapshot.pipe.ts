import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

export class InvestorSnapshotPipe implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>, void> {
  constructor(private readonly repository: DashboardRepository) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<Record<string, unknown>>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const tenantId = (event.context as Record<string, string>).tenantId;
          const payload = event.subject as Record<string, unknown>;

          const updates: Record<string, string | undefined> = {};

          switch (event.type) {
            case 'ONBOARDING_COMPLETED':
              updates.operatingMode = payload.operatingMode as string;
              updates.riskLevel = String(payload.riskScore ?? '');
              updates.goalType = payload.goalId as string;
              updates.onboardedAt = event.timestamp;
              break;

            case 'GOAL_SET':
            case 'GOAL_UPDATED':
              updates.goalType = payload.objective as string;
              break;

            case 'RISK_PROFILE_SET':
            case 'RISK_PROFILE_UPDATED':
              updates.riskLevel = String(payload.score ?? '');
              break;

            default:
              break;
          }

          await this.repository.upsertInvestorSnapshot(tenantId, updates);

          logger.info('Updated investor snapshot projection', {
            tenantId,
            eventType: event.type,
          });
        })(),
      ),
    );
  }
}
