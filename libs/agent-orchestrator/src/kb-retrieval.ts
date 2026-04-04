import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

export interface KBClientConfig {
  readonly knowledgeBaseId: string;
  readonly region: string;
}

export interface KBResult {
  readonly text: string;
  readonly score: number;
}

export interface KBClient {
  retrieve(query: string, topK?: number): Promise<KBResult[]>;
}

export function createKBClient(config: KBClientConfig): KBClient {
  const client = new BedrockAgentRuntimeClient({ region: config.region });

  return {
    async retrieve(query: string, topK = 5): Promise<KBResult[]> {
      try {
        const response = await client.send(
          new RetrieveCommand({
            knowledgeBaseId: config.knowledgeBaseId,
            retrievalQuery: { text: query },
            retrievalConfiguration: {
              vectorSearchConfiguration: { numberOfResults: topK },
            },
          }),
        );

        return (response.retrievalResults ?? []).map((r) => ({
          text: r.content?.text ?? '',
          score: r.score ?? 0,
        }));
      } catch {
        return [];
      }
    },
  };
}
