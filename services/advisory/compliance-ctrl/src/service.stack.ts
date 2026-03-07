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

export class ComplianceCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'compliance-ctrl',
    });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda — handles DECISION_PACKET_CREATED / ENRICHED
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(eventListener);

    // Decision ingress: EventBridge -> SQS -> event-listener
    new Ingress(this, 'DecisionIngress', {
      eventBus: EventBus.fromEventBusName(this, 'AdvisoryBus', naming.eventBusName()),
      eventTypes: ['DECISION_PACKET_CREATED', 'DECISION_PACKET_ENRICHED'],
      handler: eventListener,
    });

    // Mandate listener Lambda — handles mandate lifecycle events
    const mandateListener = new NodejsFunction(this, 'MandateListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'mandate-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(mandateListener);

    // Mandate ingress: EventBridge -> SQS -> mandate-listener
    new Ingress(this, 'MandateIngress', {
      eventBus: EventBus.fromEventBusName(this, 'AdvisoryBus2', naming.eventBusName()),
      eventTypes: [
        'MANDATE_GRANTED',
        'MANDATE_UPDATED',
        'MANDATE_REVOKED',
        'OPERATING_MODE_CHANGED',
      ],
      handler: mandateListener,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'compliance-ctrl',
      publishableTypes: ['ComplianceCheck', 'AuditArtifact'],
    });
  }
}
