import { join } from 'path';
import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class BrokerAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'execution', service: 'broker-adpt', serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['ORDER_SUBMITTED', 'WITHDRAWAL_REQUESTED', 'DEPOSIT_INITIATED'],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition'],
      handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
    });

    this.addObservability({ ingress, egress });
  }
}
