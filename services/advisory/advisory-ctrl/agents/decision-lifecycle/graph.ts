import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Decision Lifecycle Agent. You orchestrate the advisory
decision pipeline: interpreting investor goals, evaluating market conditions, constructing portfolios,
and producing decision packets for compliance review. You coordinate multiple sub-agents and tools
to produce comprehensive, auditable investment recommendations.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_SONNET_ID'] ?? 'us.anthropic.claude-sonnet-4-6-20250514',
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
