import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
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

export class InvestorCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'investor-ctrl', domain: 'investor', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Ingress: investor EventBridge bus -> SQS -> event-listener Lambda
    const triggerIngress = new Ingress(this, 'TriggerIngress', {
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        'ONBOARDING_COMPLETED',
        'MANDATE_GRANTED',
        'GOAL_UPDATED',
        'DEPOSIT_INITIATED',
        'OPERATING_MODE_CHANGED',
        'DECISION_APPROVED',
        'ORDER_FILLED',
        'BALANCE_UPDATED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'investor-ctrl',
      state,
    });

    // Egress: DynamoDB Streams -> EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.getTable(),
      busName: naming.eventBusName(),
      serviceName: 'investor-ctrl',
      publishableTypes: ['Notification', 'MonthlyReport'],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [triggerIngress.handler],
      dlqs: [triggerIngress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'investor-ctrl',
      lambdaFunctions: [triggerIngress.handler],
      dlqs: [triggerIngress.dlq, egress.dlq],
    });
  }
}
