import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';

export class BrokerAlpacaAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });
    // Ingress, Egress, and handler wiring will be added in subsequent tasks.
    // DDB table is provisioned by ServiceStack base (adapter has state: OrderMapping, TransferMapping, PollingState).
  }
}
