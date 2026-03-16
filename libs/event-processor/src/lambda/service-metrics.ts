import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const NAMESPACE = 'Nestfolio';

export { MetricUnit };

export function createServiceMetrics(serviceName: string): Metrics {
  return new Metrics({
    namespace: NAMESPACE,
    defaultDimensions: { Service: serviceName },
  });
}
