import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

import { DecisionStateType, buildDecisionGraph, AgentNodeMap } from './graph-orchestrator';

export interface InvokeGraphOptions {
  /** Agent node map for the primary graph. */
  nodeMap: AgentNodeMap;
  /** Optional fallback node map used when the primary graph fails. */
  fallbackNodeMap?: AgentNodeMap;
  /** Logger instance. Defaults to a new Logger. */
  logger?: Logger;
  /** Metrics instance. Defaults to a new Metrics. */
  metrics?: Metrics;
}

/**
 * Invokes the decision lifecycle graph with observability and fallback support.
 *
 * - Logs graph invocation start/end with structured metadata
 * - Tracks latency via Powertools Metrics
 * - On transient failure, falls back to a secondary graph if provided
 */
export async function invokeGraph(
  input: Partial<DecisionStateType>,
  options: InvokeGraphOptions,
): Promise<DecisionStateType> {
  const log = options.logger ?? new Logger({ serviceName: 'agent-core' });
  const metrics = options.metrics ?? new Metrics({ namespace: 'Nestfolio/AgentCore' });

  const startTime = Date.now();

  log.info('Graph invocation started', { input: summariseInput(input) });

  try {
    const graph = buildDecisionGraph(options.nodeMap);
    const result = (await graph.invoke(input)) as DecisionStateType;

    const latencyMs = Date.now() - startTime;
    metrics.addMetric('GraphLatency', MetricUnit.Milliseconds, latencyMs);
    metrics.addMetric('GraphSuccess', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();

    log.info('Graph invocation completed', { latencyMs });

    return result;
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    metrics.addMetric('GraphLatency', MetricUnit.Milliseconds, latencyMs);
    metrics.addMetric('GraphError', MetricUnit.Count, 1);

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    log.error('Graph invocation failed', { error: errorMessage, latencyMs });

    if (options.fallbackNodeMap) {
      log.info('Attempting fallback graph invocation');

      try {
        const fallbackGraph = buildDecisionGraph(options.fallbackNodeMap);
        const fallbackResult = (await fallbackGraph.invoke(
          input,
        )) as DecisionStateType;

        const fallbackLatencyMs = Date.now() - startTime;
        metrics.addMetric(
          'FallbackLatency',
          MetricUnit.Milliseconds,
          fallbackLatencyMs,
        );
        metrics.addMetric('FallbackSuccess', MetricUnit.Count, 1);
        metrics.publishStoredMetrics();

        log.info('Fallback graph invocation completed', {
          latencyMs: fallbackLatencyMs,
        });

        return fallbackResult;
      } catch (fallbackError: unknown) {
        const fbErrorMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        log.error('Fallback graph invocation also failed', {
          error: fbErrorMessage,
        });
        metrics.addMetric('FallbackError', MetricUnit.Count, 1);
        metrics.publishStoredMetrics();

        throw fallbackError;
      }
    }

    metrics.publishStoredMetrics();
    throw error;
  }
}

function summariseInput(input: Partial<DecisionStateType>): Record<string, boolean> {
  const summary: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    summary[key] = value != null;
  }
  return summary;
}
