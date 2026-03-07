import { log, logger } from '@nestfolio/platform-core';
import type { ProposedTrade } from '@nestfolio/domain-core';
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
  constructor(private readonly repository: OrderRepository) {}

  @log()
  async checkReconciliationLock(_tenantId: string): Promise<boolean> {
    // Phase 2: Simplified — always returns false (no lock)
    return false;
  }

  @log()
  async checkConflictingStagedOrders(tenantId: string, instruments: string[]): Promise<boolean> {
    const conflicts = await this.repository.getConflictingStagedOrders(tenantId, instruments);
    const hasConflicts = conflicts.length > 0;
    if (hasConflicts) {
      logger.info('Conflicting staged orders found', { tenantId, instruments, count: conflicts.length });
    }
    return hasConflicts;
  }

  @log()
  async checkCoolDown(tenantId: string, instruments: string[]): Promise<boolean> {
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
  }

  @log()
  async runAllChecks(tenantId: string, proposedTrades: ProposedTrade[]): Promise<SafetyCheckResult> {
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
  }
}
