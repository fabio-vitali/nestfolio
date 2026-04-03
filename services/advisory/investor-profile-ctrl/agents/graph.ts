import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Investor Profile Agent. Your role is to interpret
investor goals, assess risk tolerance, and evaluate suitability against regulatory frameworks.
Produce structured goal interpretations and risk evaluations.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_HAIKU_ID'] ?? 'us.anthropic.claude-haiku-4-5-20251001',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.messages,
      ]);
      return { messages: [response] };
    })
    .addEdge('__start__', 'agent')
    .compile();
}
