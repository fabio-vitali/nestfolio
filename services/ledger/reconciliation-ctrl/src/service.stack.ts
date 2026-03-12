import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Egress,
  Monitoring,
  ServiceDashboard,
  createNamingService,
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class ReconciliationCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'reconciliation-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'reconciliation-ctrl', domain: 'ledger', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Look up ledger-hub bus ARN from SSM
    const ledgerBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-ledger/event-hub/busArn`,
    );
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingress: ledger EventBridge bus -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: ledgerBus,
      eventTypes: [
        'PORTFOLIO_UPDATED',
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'CORPORATE_ACTION_APPLIED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'reconciliation-ctrl',
      state,
    });

    // Egress: DynamoDB Streams -> EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.getTable(),
      busName: ledgerBus.eventBusName,
      serviceName: 'reconciliation-ctrl',
      publishableTypes: ['ReconciliationResult', 'DriftRecord'],
      customEventTypeMap: {
        'ReconciliationResult:INSERT': 'RECONCILIATION_COMPLETED',
        'DriftRecord:INSERT': 'PORTFOLIO_DRIFT_DETECTED',
      },
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [ingress.handler],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'reconciliation-ctrl',
      lambdaFunctions: [ingress.handler],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
