import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

// dashboard-bff projects advisory-bff's authoritative AdvisoryStatus aggregate
// (P3, projected from the owner's versioned announcement). No accumulate.
// The producer's field is `inFlightCount`; the dashboard read model exposes it as
// `pendingDecisionsCount` (GraphQL AdvisoryStatus.pendingDecisionsCount).
// tenantId is read from the event CONTEXT (the AdvisoryStatus subject is DRY — identity
// travels in RequestContext, not the subject).
export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<{
    inFlightCount: number; __version: number;
    generatingCount?: number; failedCount?: number; oldestGeneratingAt?: string | null;
  }>>,
): WriteIntent | undefined => {
  const p = uow.event.subject;
  if (typeof p.__version !== 'number') return undefined;
  return projectVersioned(
    'AdvisoryStatus',
    {
      pendingDecisionsCount: p.inFlightCount,
      generatingCount: p.generatingCount ?? 0,
      failedCount: p.failedCount ?? 0,
      oldestGeneratingAt: p.oldestGeneratingAt ?? null,
    },
    { version: p.__version, overrides: { pk: `T#${uow.event.context.tenantId}`, sk: 'AdvisoryStatus' } },
  );
};
