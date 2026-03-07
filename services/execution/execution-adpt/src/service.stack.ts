import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Egress,
  createNamingService,
  defaultLambdaProps,
} from '@nestfolio/cdk-constructs';

export class ExecutionAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'execution-adpt',
    });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda — handles ORDER_SUBMITTED / WITHDRAWAL_REQUESTED
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(eventListener);

    // Ingress: EventBridge -> SQS -> event-listener
    new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'ExecutionBus', naming.eventBusName()),
      eventTypes: ['ORDER_SUBMITTED', 'WITHDRAWAL_REQUESTED'],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'execution-adpt',
      publishableTypes: ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition'],
    });
  }
}
