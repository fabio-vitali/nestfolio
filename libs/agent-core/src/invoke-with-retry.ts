import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage, BaseMessage } from '@langchain/core/messages';

import { AgentType } from './model-config';
import { loadPromptTemplate } from './prompt-templates';
import { getOutputSchema } from './output-schemas';
import { validateAgentOutput } from './output-validation';
import { getEscalationPath } from './tier-escalation';
import { createFallbackNode } from './fallback-agents';
import type { AgentNodeFn } from './agent-factory';

export interface InvokeWithRetryOptions {
  maxAttempts?: number; // default: 3
  region?: string;
  logger?: Logger;
  metrics?: Metrics;
}

/**
 * Creates an agent node function with automatic validation, retry, and tier escalation.
 *
 * On validation failure:
 * 1. Retries at same tier
 * 2. Escalates to next tier (Haiku -> Sonnet -> Opus)
 * 3. Falls back to deterministic output
 */
export function createRetryableAgentNode(
  type: AgentType,
  options?: InvokeWithRetryOptions,
): AgentNodeFn {
  const maxAttempts = options?.maxAttempts ?? 3;
  const region = options?.region ?? process.env['AWS_REGION'] ?? 'us-east-1';
  const log = options?.logger ?? new Logger({ serviceName: 'agent-core' });
  const metrics = options?.metrics ?? new Metrics({ namespace: 'Nestfolio/AgentCore' });

  const systemPrompt = loadPromptTemplate(type);
  const outputSchema = getOutputSchema(type);
  const escalationPath = getEscalationPath(type);
  const fallback = createFallbackNode(type);

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let lastError: Error | null = null;
    let stepIndex = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const step = escalationPath[Math.min(stepIndex, escalationPath.length - 1)];

      try {
        const model = new ChatBedrockConverse({
          model: step.modelId,
          region,
          maxTokens: step.maxTokens,
          temperature: step.temperature,
        });

        // Type workaround for TS2589
        interface StructuredInvokable {
          invoke(messages: BaseMessage[]): Promise<Record<string, unknown>>;
        }
        interface WithStructuredOutput {
          withStructuredOutput(schema: unknown): StructuredInvokable;
        }
        const structuredModel = (model as unknown as WithStructuredOutput).withStructuredOutput(
          outputSchema,
        );

        const messages: BaseMessage[] = [
          new SystemMessage(systemPrompt),
          new HumanMessage(JSON.stringify(state)),
        ];

        const result = await structuredModel.invoke(messages);

        // Validate output
        const validation = validateAgentOutput(type, result);

        if (validation.valid) {
          if (step.isEscalated) {
            metrics.addMetric('TierEscalationSuccess', MetricUnit.Count, 1);
            log.info('Agent succeeded after escalation', {
              agent: type,
              escalationLevel: step.escalationLevel,
              modelId: step.modelId,
            });
          }
          metrics.addMetric('AgentSuccess', MetricUnit.Count, 1);
          metrics.publishStoredMetrics();
          return { [type]: result };
        }

        // Validation failed
        log.warn('Agent output validation failed', {
          agent: type,
          attempt,
          modelId: step.modelId,
          errors: validation.errors,
        });
        metrics.addMetric('ValidationFailure', MetricUnit.Count, 1);

        // Escalate to next tier
        if (stepIndex < escalationPath.length - 1) {
          stepIndex++;
          log.info('Escalating to next model tier', {
            agent: type,
            nextModelId: escalationPath[stepIndex].modelId,
          });
          metrics.addMetric('TierEscalation', MetricUnit.Count, 1);
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log.error('Agent invocation error', {
          agent: type,
          attempt,
          error: lastError.message,
        });
        metrics.addMetric('AgentInvocationError', MetricUnit.Count, 1);

        // Escalate on error too
        if (stepIndex < escalationPath.length - 1) {
          stepIndex++;
        }
      }
    }

    // All attempts exhausted, use deterministic fallback
    log.error('All retry attempts exhausted, using deterministic fallback', {
      agent: type,
      lastError: lastError?.message,
    });
    metrics.addMetric('FallbackActivated', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();

    return fallback(state);
  };
}
