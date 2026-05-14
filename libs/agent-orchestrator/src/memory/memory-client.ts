import { Logger } from '@aws-lambda-powertools/logger';
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const logger = new Logger({ serviceName: 'agent-orchestrator' });

export type LongTermNamespace = 'preferences' | 'signals' | 'rationale';

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

export interface EmitLongTermEventInput {
  namespace: LongTermNamespace;
  payload: Record<string, unknown>;
}

export interface DecisionSession {
  searchLongTermMemory(
    namespace: LongTermNamespace,
    query: string,
    topK?: number,
  ): Promise<MemoryRecord[]>;
  emitLongTermEvent(input: EmitLongTermEventInput): Promise<void>;
}

export interface MemoryClient {
  openDecisionSession(tenantId: string, decisionId: string): DecisionSession;
  searchTenantMemory(
    tenantId: string,
    namespace: LongTermNamespace,
    query: string,
    topK?: number,
  ): Promise<MemoryRecord[]>;
}

export function createMemoryClient(config: MemoryClientConfig): MemoryClient {
  const client = new BedrockAgentCoreClient({ region: config.region });

  return {
    openDecisionSession(tenantId: string, decisionId: string): DecisionSession {
      return {
        async searchLongTermMemory(
          namespace: LongTermNamespace,
          query: string,
          topK = 5,
        ): Promise<MemoryRecord[]> {
          const ns = `/${config.serviceName}/${tenantId}/${namespace}`;
          const resp = await client.send(
            new RetrieveMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace: ns,
              searchCriteria: { searchQuery: query, topK },
            })
          );
          return (resp.memoryRecordSummaries ?? []).map(mapRecord);
        },
        async emitLongTermEvent(input: EmitLongTermEventInput): Promise<void> {
          // Best-effort SDK emit. Failures are logged but do not throw — long-term
          // recall is non-critical to the agent's success path.
          // Serialisation errors throw synchronously so callers see them in dev.
          const serialised = JSON.stringify(input.payload);
          try {
            await client.send(
              new CreateEventCommand({
                memoryId: config.memoryId,
                actorId: tenantId,
                sessionId: decisionId,
                eventTimestamp: new Date(),
                payload: [
                  {
                    conversational: {
                      role: 'ASSISTANT',
                      content: { text: serialised },
                    },
                  },
                ],
              })
            );
          } catch (err) {
            logger.warn('emitLongTermEvent failed', {
              namespace: input.namespace,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    },

    async searchTenantMemory(
      tenantId: string,
      namespace: LongTermNamespace,
      query: string,
      topK = 5,
    ): Promise<MemoryRecord[]> {
      const ns = `/${config.serviceName}/${tenantId}/${namespace}`;
      const resp = await client.send(
        new RetrieveMemoryRecordsCommand({
          memoryId: config.memoryId,
          namespace: ns,
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
