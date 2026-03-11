import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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

export class ExecutionAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'execution-adpt',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'execution-adpt', domain: 'execution', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda — handles ORDER_SUBMITTED / WITHDRAWAL_REQUESTED
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'execution-adpt' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({ actions: ['events:PutEvents'], resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`] }));

    // Ingress: EventBridge -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'ExecutionBus', naming.eventBusName()),
      eventTypes: ['ORDER_SUBMITTED', 'WITHDRAWAL_REQUESTED', 'DEPOSIT_INITIATED'],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'execution-adpt',
      publishableTypes: ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition'],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'execution-adpt',
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
