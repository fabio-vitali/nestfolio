import { logger } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { ProposedTrade } from '@nestfolio/advisory-ctrl/domain';
import { OrderRepository } from '../repositories/order.repository';

export interface SafetyCheckResult {
  passed: boolean;
  reason?: string;
  checks: {
    reconciliationLock: boolean;
    conflictingStagedOrders: boolean;
    coolDown: boolean;
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

  readonly checkCoolDown = this.log('checkCoolDown',
    async (tenantId: string, instruments: string[]): Promise<boolean> => {
      for (const instrument of instruments) {
        const coolDown = await this.repository.getCoolDown(tenantId, instrument);
        if (coolDown) {
          const expiresAt = coolDown['expiresAt'] as string;
          if (new Date(expiresAt) > new Date()) {
            logger.info('Cool down active for instrument', { tenantId, instrument, expiresAt });
            return true;
          }
        }
      }
      return false;
    },
  );

  readonly runAllChecks = this.log('runAllChecks',
    async (tenantId: string, proposedTrades: ProposedTrade[]): Promise<SafetyCheckResult> => {
      const instruments = proposedTrades.map((t) => t.symbol);

      const reconciliationLock = await this.checkReconciliationLock(tenantId);
      if (reconciliationLock) {
        return {
          passed: false,
          reason: 'Reconciliation is in progress',
          checks: { reconciliationLock: true, conflictingStagedOrders: false, coolDown: false },
        };
      }

      const conflictingStagedOrders = await this.checkConflictingStagedOrders(tenantId, instruments);
      if (conflictingStagedOrders) {
        return {
          passed: false,
          reason: 'Conflicting staged orders exist for the same instruments',
          checks: { reconciliationLock: false, conflictingStagedOrders: true, coolDown: false },
        };
      }

      const coolDown = await this.checkCoolDown(tenantId, instruments);
      if (coolDown) {
        return {
          passed: false,
          reason: 'Cool down period active for one or more instruments',
          checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: true },
        };
      }

      return {
        passed: true,
        checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
      };
    },
  );
}
