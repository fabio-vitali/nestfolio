import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { CompiledGraph } from './create-orchestrator';
import type { ServiceUnavailableResponse, InvokeOptions } from './types';
import { AgentTracer } from './agent-tracer';

const defaultLogger = new Logger({ serviceName: 'agent-orchestrator' });
const defaultMetrics = new Metrics({ namespace: 'AgentOrchestrator' });

export async function invokeOrchestrator(
  graph: CompiledGraph,
  input: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<Record<string, unknown> | ServiceUnavailableResponse> {
  const logger = options?.logger ?? defaultLogger;
  const metrics = options?.metrics ?? defaultMetrics;
  const tracer = new AgentTracer();
  const startTime = Date.now();
  let status: 'success' | 'error' = 'success';
  let result: Record<string, unknown> | ServiceUnavailableResponse;

  logger.info('Orchestrator invocation started', { inputKeys: Object.keys(input) });

  try {
    result = await graph.invoke(input, { callbacks: [tracer], recursionLimit: 10 });
    const duration = Date.now() - startTime;
    logger.info('Orchestrator invocation completed', { duration });
    metrics.addMetric('OrchestratorSuccess', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);
    return result;
  } catch (error) {
    status = 'error';
    const duration = Date.now() - startTime;
    const reason = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Orchestrator invocation failed', { duration, reason });
    metrics.addMetric('OrchestratorFailure', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);
    result = { serviceUnavailable: true, reason };
    return result;
  } finally {
    const envelope = tracer.build(status);
    logger.info('Orchestrator envelope summary', {
      status,
      latencyMs: envelope['gen_ai.invocation.latency_ms'],
      llmCallCount: envelope.llmCalls.length,
      inputTokensTotal: envelope.llmCalls.reduce(
        (sum, call) => sum + call['gen_ai.usage.input_tokens'],
        0,
      ),
      outputTokensTotal: envelope.llmCalls.reduce(
        (sum, call) => sum + call['gen_ai.usage.output_tokens'],
        0,
      ),
      perCall: envelope.llmCalls.map((call) => ({
        node: call.nodeName,
        model: call['gen_ai.request.model'],
        inputTokens: call['gen_ai.usage.input_tokens'],
        outputTokens: call['gen_ai.usage.output_tokens'],
        latencyMs: call.latencyMs,
        escalatedFromTier: call.escalatedFromTier,
      })),
    });
    // Narrow via the discriminant: if emitter is present, the type system
    // guarantees `agent` and `correlationId` are also present (see InvokeOptions).
    if (options?.emitter) {
      try {
        await options.emitter.emit(envelope, {
          tenantId: options.tenantId ?? '',
          correlationId: options.correlationId,
          agent: options.agent,
        });
      } catch (emitErr) {
        logger.warn('Trace emission failed', { err: emitErr });
      }
    }
  }
}
