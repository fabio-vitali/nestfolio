import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage, BaseMessage } from '@langchain/core/messages';

import { AgentType, getModelConfig } from './model-config';
import { loadPromptTemplate } from './prompt-templates';
import { getOutputSchema } from './output-schemas';

/**
 * The shape of a LangGraph node function produced by the factory.
 * Accepts the current graph state and returns a partial state update.
 */
export type AgentNodeFn = (state: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface CreateAgentNodeOptions {
  /** AWS region for Bedrock. Defaults to AWS_REGION env var or 'us-east-1'. */
  region?: string;
}

/**
 * Creates a LangGraph-compatible node function for the given agent type.
 *
 * The returned function:
 * 1. Reads the system prompt for the agent type
 * 2. Instantiates a ChatBedrockConverse model with structured output
 * 3. Invokes the model with the state context
 * 4. Returns the parsed, schema-validated output under the agent type key
 */
export function createAgentNode(
  type: AgentType,
  options?: CreateAgentNodeOptions,
): AgentNodeFn {
  const modelConfig = getModelConfig(type);
  const systemPrompt = loadPromptTemplate(type);
  const outputSchema = getOutputSchema(type);

  const model = new ChatBedrockConverse({
    model: modelConfig.modelId,
    region: options?.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
    maxTokens: modelConfig.maxTokens,
    temperature: modelConfig.temperature,
  });

  // Cast model to a simplified interface to work around LangGraph's
  // excessively deep generic type instantiation (TS2589) in withStructuredOutput
  interface StructuredInvokable {
    invoke(messages: BaseMessage[]): Promise<Record<string, unknown>>;
  }
  interface WithStructuredOutput {
    withStructuredOutput(schema: unknown): StructuredInvokable;
  }
  const structuredModel = (model as unknown as WithStructuredOutput).withStructuredOutput(outputSchema);

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(JSON.stringify(state)),
    ];

    const result = await structuredModel.invoke(messages);

    return { [type]: result };
  };
}
