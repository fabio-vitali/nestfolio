import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { CompiledGraph } from './create-orchestrator';
import type { ServiceUnavailableResponse, InvokeOptions } from './types';

const defaultLogger = new Logger({ serviceName: 'agent-orchestrator' });
const defaultMetrics = new Metrics({ namespace: 'AgentOrchestrator' });

export async function invokeOrchestrator(
  graph: CompiledGraph,
  input: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<Record<string, unknown> | ServiceUnavailableResponse> {
  const logger = (options?.logger as Logger) ?? defaultLogger;
  const metrics = (options?.metrics as Metrics) ?? defaultMetrics;
  const startTime = Date.now();

  logger.info('Orchestrator invocation started', { inputKeys: Object.keys(input) });

  try {
    const result = await graph.invoke(input);
    const duration = Date.now() - startTime;

    logger.info('Orchestrator invocation completed', { duration });
    metrics.addMetric('OrchestratorSuccess', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const reason = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Orchestrator invocation failed', { duration, reason });
    metrics.addMetric('OrchestratorFailure', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);

    return { serviceUnavailable: true, reason };
  }
}
