import { EventBridgeClient } from '@nestfolio/test-support';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

export interface PortfolioUpdatedShape {
  positions: Record<string, { quantity: number; lastFillPrice: number }>;
  cashBalanceCents: number;
  lastEventSequence?: number;
}

/**
 * Emits a synthetic PORTFOLIO_UPDATED to the advisory EventBridge bus,
 * scoped to `decision-workflow-ctrl` (source
 * `integration-test:decision-workflow-ctrl`).
 *
 * This matches the SnapshotProjectorIngress `$or` content filter, so the
 * projection materialises in the DWC state table without going through the
 * real ledger → ledger-adpt chain.
 *
 * The EventBridgeClient wrapper handles busArn SSM lookup, envelope wrapping,
 * and put-event retry logic.
 */
export async function injectPortfolioUpdated(
  ctx: TestContext,
  tenant: FreshTenant,
  body: PortfolioUpdatedShape,
): Promise<void> {
  const eb = new EventBridgeClient(ctx);
  await eb.putEvent({
    bus: 'advisory',
    targetService: 'decision-workflow-ctrl',
    detailType: 'PORTFOLIO_UPDATED',
    detail: {
      tenantId: tenant.tenantId,
      streamType: 'CASH',
      snapshot: {
        positions: body.positions,
        cashBalanceCents: body.cashBalanceCents,
        lastEventSequence: body.lastEventSequence ?? 1,
      },
    },
  });
}
