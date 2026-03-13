import { StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class ReconciliationCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, subsystem: 'ledger', service: 'reconciliation-ctrl', serviceDir: __dirname });

    const prefix = this.node.tryGetContext('prefix');
    const ledgerBusArn = StringParameter.valueForStringParameter(this, `/nestfolio/${prefix}-ledger/event-hub/busArn`);
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
      customEventTypeMap: {
        'ReconciliationResult:INSERT': 'RECONCILIATION_COMPLETED',
        'DriftRecord:INSERT': 'PORTFOLIO_DRIFT_DETECTED',
      },
    });

    this.addObservability({ ingress, egress });
  }
}
