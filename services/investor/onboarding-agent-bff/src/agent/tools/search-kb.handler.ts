import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

const client = new BedrockAgentRuntimeClient({});
const KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? '';

export async function handler(event: { query: string }): Promise<string> {
  const response = await client.send(
    new RetrieveAndGenerateCommand({
      input: { text: event.query },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-20250514',
        },
      },
    }),
  );

  const text = response.output?.text ?? '';
  return text || 'Non ho trovato informazioni su questo argomento nella documentazione.';
}
