import {
  BedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';

export interface MemoryClientConfig {
  memoryId: string;
  region: string;
  serviceName: string;
}

export interface MemoryRecord {
  content: string;
  score: number;
  memoryRecordId: string;
}

export interface DecisionSession {
  searchLongTermMemory(query: string, topK?: number): Promise<MemoryRecord[]>;
}

export interface MemoryClient {
  openDecisionSession(tenantId: string, decisionId: string): DecisionSession;
  searchTenantMemory(tenantId: string, query: string, topK?: number): Promise<MemoryRecord[]>;
}

export function createMemoryClient(config: MemoryClientConfig): MemoryClient {
  const client = new BedrockAgentCoreClient({ region: config.region });

  return {
    openDecisionSession(tenantId: string, _decisionId: string): DecisionSession {
      return {
        async searchLongTermMemory(query: string, topK = 5): Promise<MemoryRecord[]> {
          const namespace = `/${config.serviceName}/${tenantId}`;
          const resp = await client.send(
            new RetrieveMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace,
              searchCriteria: { searchQuery: query, topK },
            })
          );
          return (resp.memoryRecordSummaries ?? []).map(mapRecord);
        },
      };
    },

    async searchTenantMemory(tenantId: string, query: string, topK = 5): Promise<MemoryRecord[]> {
      const namespace = `/${config.serviceName}/${tenantId}`;
      const resp = await client.send(
        new RetrieveMemoryRecordsCommand({
          memoryId: config.memoryId,
          namespace,
          searchCriteria: { searchQuery: query, topK },
        })
      );
      return (resp.memoryRecordSummaries ?? []).map(mapRecord);
    },
  };
}

interface MemoryRecordSummaryLike {
  memoryRecordId?: string;
  content?: { text?: string };
  score?: number;
}

function mapRecord(r: MemoryRecordSummaryLike): MemoryRecord {
  return {
    content: r.content?.text ?? '',
    score: r.score ?? 0,
    memoryRecordId: r.memoryRecordId ?? '',
  };
}
