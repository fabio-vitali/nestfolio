import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

// dashboard-bff projects advisory-bff's authoritative AdvisoryStatus aggregate
// (P3, projected from the owner's versioned announcement). No accumulate.
// The producer's field is `inFlightCount`; the dashboard read model exposes it as
// `pendingDecisionsCount` (GraphQL AdvisoryStatus.pendingDecisionsCount).
export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<{ tenantId: string; inFlightCount: number; __version: number }>>,
): WriteIntent | undefined => {
  const p = uow.event.subject;
  if (typeof p.__version !== 'number') return undefined;
  return projectVersioned(
    'AdvisoryStatus',
    { pendingDecisionsCount: p.inFlightCount },
    { version: p.__version, overrides: { pk: `T#${p.tenantId}`, sk: 'AdvisoryStatus' } },
  );
};
