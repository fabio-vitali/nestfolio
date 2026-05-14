import type { MemoryClient, DecisionSession, MemoryRecord } from './memory-client';

const noOpSession: DecisionSession = {
  async searchLongTermMemory(): Promise<MemoryRecord[]> {
    return [];
  },
};

export function createNoOpMemoryClient(): MemoryClient {
  return {
    openDecisionSession(): DecisionSession {
      return noOpSession;
    },
    async searchTenantMemory(): Promise<MemoryRecord[]> {
      return [];
    },
  };
}
