import {
  BedrockAgentCoreClient,
  CreateEventCommand,
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
          await client.send(
            new CreateEventCommand({
              memoryId: config.memoryId,
              actorId: tenantId,
              sessionId: decisionId,
              eventTimestamp: new Date(),
              payload: [
                {
                  conversational: {
                    content: { text: JSON.stringify(output) },
                    role: 'ASSISTANT',
                  },
                },
              ],
            })
          );
        },

        async readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]> {
          const namespace = `/${upstreamService}/${tenantId}/decisions/${decisionId}`;
          const resp = await client.send(
            new RetrieveMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace,
              searchCriteria: { searchQuery: 'agent output', topK: 5 },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecord(r: any): MemoryRecord {
  return {
    content: r.content?.text ?? '',
    score: r.score ?? 0,
    memoryRecordId: r.memoryRecordId ?? '',
  };
}
