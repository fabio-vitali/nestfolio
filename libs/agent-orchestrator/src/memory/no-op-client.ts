import type { MemoryClient, DecisionSession, MemoryRecord, EmitLongTermEventInput } from './memory-client';

const noOpSession: DecisionSession = {
  async searchLongTermMemory(): Promise<MemoryRecord[]> {
    return [];
  },
  async emitLongTermEvent(_input: EmitLongTermEventInput): Promise<void> {
    return;
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
