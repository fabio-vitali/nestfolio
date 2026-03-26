import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Egress } from '@nestfolio/cdk-constructs/core';

export class BrokerCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // State: DDB table (BrokerOrder, NormalizedEvent, CircuitBreaker, ExecutionMode)
    // — created by ServiceStack base class

    // Egress: CDC for NormalizedEvent → canonical events
    const _egress = new Egress(this, 'Egress', {
      publishableTypes: ['NormalizedEvent'],
    });

    // SF + Ingress + Lambdas added in subsequent tasks
  }
}
