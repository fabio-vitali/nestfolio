import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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
  defaultLambdaProps,
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

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: {
        TABLE_NAME: state.table.tableName,
        BUS_NAME: ledgerBus.eventBusName,
        SERVICE_NAME: 'reconciliation-ctrl',
      },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [ledgerBusArn],
    }));

    // Ingress: ledger EventBridge bus -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: ledgerBus,
      eventTypes: [
        'PORTFOLIO_UPDATED',
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'CORPORATE_ACTION_APPLIED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.table,
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
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'reconciliation-ctrl',
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
