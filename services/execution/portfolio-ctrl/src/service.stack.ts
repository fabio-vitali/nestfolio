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

export class PortfolioCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'portfolio-ctrl',
    });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(eventListener);

    // Ingress: execution EventBridge bus -> SQS -> event-listener
    new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'ExecutionBus', naming.eventBusName()),
      eventTypes: [
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'ORDER_FILLED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge
    new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'portfolio-ctrl',
      publishableTypes: ['Reconciliation', 'DriftRecord'],
    });
  }
}
