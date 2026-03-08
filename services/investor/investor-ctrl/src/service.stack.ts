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
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class InvestorCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix') ?? 'dev';
    applyStandardTags(this, { service: 'investor-ctrl', domain: 'investor', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda (trigger events)
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(eventListener);

    // Ingress: investor EventBridge bus -> SQS -> event-listener
    new Ingress(this, 'TriggerIngress', {
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        'ONBOARDING_COMPLETED',
        'MANDATE_GRANTED',
        'GOAL_UPDATED',
        'DEPOSIT_INITIATED',
        'OPERATING_MODE_CHANGED',
        'DECISION_APPROVED',
        'ORDER_FILLED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge
    new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'investor-ctrl',
      publishableTypes: ['Notification', 'MonthlyReport'],
    });
  }
}
