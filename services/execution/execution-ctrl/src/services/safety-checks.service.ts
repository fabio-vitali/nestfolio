import { logger } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import { OrderRepository } from '../repositories/order.repository';

export interface SafetyCheckResult {
  passed: boolean;
  reason?: string;
  checks: {
    reconciliationLock: boolean;
    conflictingStagedOrders: boolean;
  };
}

export class SafetyChecksService {
  private readonly log = withMethodLogging('SafetyChecksService');

  constructor(private readonly repository: OrderRepository) {}

  readonly checkReconciliationLock = this.log('checkReconciliationLock',
    async (_tenantId: string): Promise<boolean> => {
      // Phase 2: Simplified — always returns false (no lock)
      return false;
    },
  );

  readonly checkConflictingStagedOrders = this.log('checkConflictingStagedOrders',
    async (tenantId: string, instruments: string[]): Promise<boolean> => {
      const conflicts = await this.repository.getConflictingStagedOrders(tenantId, instruments);
      const hasConflicts = conflicts.length > 0;
      if (hasConflicts) {
        logger.info('Conflicting staged orders found', { tenantId, instruments, count: conflicts.length });
      }
      return hasConflicts;
    },
  );

  readonly runAllChecks = this.log('runAllChecks',
    async (tenantId: string, instruments: string[]): Promise<SafetyCheckResult> => {
      const reconciliationLock = await this.checkReconciliationLock(tenantId);
      if (reconciliationLock) {
        return {
          passed: false,
          reason: 'Reconciliation is in progress',
          checks: { reconciliationLock: true, conflictingStagedOrders: false },
        };
      }

      const conflictingStagedOrders = await this.checkConflictingStagedOrders(tenantId, instruments);
      if (conflictingStagedOrders) {
        return {
          passed: false,
          reason: 'Conflicting staged orders exist for the same instruments',
          checks: { reconciliationLock: false, conflictingStagedOrders: true },
        };
      }

      return {
        passed: true,
        checks: { reconciliationLock: false, conflictingStagedOrders: false },
      };
    },
  );
}
