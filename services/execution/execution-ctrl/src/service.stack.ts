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

export class ExecutionCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'execution-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'execution-ctrl', domain: 'execution', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Ingress: execution EventBridge bus -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'ExecutionBus', naming.eventBusName()),
      eventTypes: [
        'DECISION_APPROVED',
        'USER_CONFIRMED',
        'CIRCUIT_BREAKER_TRIGGERED',
        'CIRCUIT_BREAKER_RESET',
        'ACCOUNT_CLOSURE_REQUESTED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'execution-ctrl',
      state,
    });

    // Egress: DynamoDB Streams -> EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.getTable(),
      busName: naming.eventBusName(),
      serviceName: 'execution-ctrl',
      publishableTypes: ['Order', 'StagedOrder'],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [ingress.handler],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'execution-ctrl',
      lambdaFunctions: [ingress.handler],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
