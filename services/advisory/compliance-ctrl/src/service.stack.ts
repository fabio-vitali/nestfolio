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

export class ComplianceCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'compliance-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'compliance-ctrl', domain: 'advisory', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Ingress: EventBridge -> SQS -> event-listener (all event types)
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'AdvisoryBus', naming.eventBusName()),
      eventTypes: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_ENRICHED',
        'MANDATE_GRANTED',
        'MANDATE_UPDATED',
        'MANDATE_REVOKED',
        'OPERATING_MODE_CHANGED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'compliance-ctrl',
      state,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    const egress = new Egress(this, 'Egress', {
      table: state.getTable(),
      busName: naming.eventBusName(),
      serviceName: 'compliance-ctrl',
      publishableTypes: ['ComplianceCheck', 'AuditArtifact'],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [ingress.handler],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'compliance-ctrl',
      lambdaFunctions: [ingress.handler],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
