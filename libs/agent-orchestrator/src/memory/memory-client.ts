import {
  BedrockAgentCoreClient,
  BatchCreateMemoryRecordsCommand,
  ListMemoryRecordsCommand,
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
  writeAgentOutput(output: Record<string, unknown>): Promise<void>;
  readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]>;
  searchLongTermMemory(query: string, topK?: number): Promise<MemoryRecord[]>;
}

export interface MemoryClient {
  openDecisionSession(tenantId: string, decisionId: string): DecisionSession;
  searchTenantMemory(tenantId: string, query: string, topK?: number): Promise<MemoryRecord[]>;
}

export function createMemoryClient(config: MemoryClientConfig): MemoryClient {
  const client = new BedrockAgentCoreClient({ region: config.region });

  return {
    openDecisionSession(tenantId: string, decisionId: string): DecisionSession {
      return {
        async writeAgentOutput(output: Record<string, unknown>): Promise<void> {
          // BatchCreateMemoryRecordsCommand records take `namespaces: string[]`
          // (plural array) per the SDK's MemoryRecordCreateInput type.
          // ListMemoryRecordsCommand below uses `namespace: string` (singular).
          // The asymmetry is SDK-mandated — do not "fix" it. requestIdentifier
          // is an idempotency key; AgentCore deduplicates retries by it.
          const namespace = `/${config.serviceName}/${tenantId}/decisions/${decisionId}`;
          await client.send(
            new BatchCreateMemoryRecordsCommand({
              memoryId: config.memoryId,
              records: [
                {
                  requestIdentifier: `${tenantId}/${decisionId}`,
                  namespaces: [namespace],
                  content: { text: JSON.stringify(output) },
                  timestamp: new Date(),
                },
              ],
            })
          );
        },

        async readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]> {
          const namespace = `/${upstreamService}/${tenantId}/decisions/${decisionId}`;
          const resp = await client.send(
            new ListMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace,
            })
          );
          return (resp.memoryRecordSummaries ?? []).map(mapRecord);
        },

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
