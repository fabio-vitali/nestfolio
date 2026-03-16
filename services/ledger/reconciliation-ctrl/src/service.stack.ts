import { StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class ReconciliationCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'ledger', service: 'reconciliation-ctrl', serviceDir: __dirname });

    const ledgerBusArn = StringParameter.valueForStringParameter(this, `/nestfolio/${this.prefix}-ledger/event-hub/busArn`);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'PORTFOLIO_UPDATED',
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'CORPORATE_ACTION_APPLIED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['ReconciliationResult', 'DriftRecord'],
      handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
    });

    this.addObservability({ ingress, egress });
  }
}
