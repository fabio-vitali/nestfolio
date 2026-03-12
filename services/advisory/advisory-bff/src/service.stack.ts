import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Egress,
  Facade,
  Monitoring,
  ServiceDashboard,
  createNamingService,
  defaultLambdaProps,
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class AdvisoryBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-bff',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'advisory-bff', domain: 'advisory', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'advisory-bff' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({ actions: ['events:PutEvents'], resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`] }));

    // Ingress: EventBridge -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'AdvisoryBus', naming.eventBusName()),
      eventTypes: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_ENRICHED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        'USER_CONFIRMATION_REQUESTED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'advisory-bff',
      publishableTypes: ['DecisionReadModel', 'UserInteraction', 'UserConfirmation', 'UserRejection'],
    });

    // Read Cognito UserPool from SSM
    const userPoolId = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/auth/userPoolId`,
    );
    const userPool = UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    const JS_FN_PATH = join(__dirname, 'graphql', 'js-function');
    const checkAuthPath = join(JS_FN_PATH, 'utils', 'check-auth.fn.js');
    const readbackPath = join(JS_FN_PATH, 'get-decision-readback.fn.js');

    // Facade: AppSync API with JS pipeline resolvers
    new Facade(this, 'Facade', {
      schemaPath: join(__dirname, 'schema.graphql'),
      userPool,
      table: state.table,
      jsResolvers: [
        { typeName: 'Query', fieldName: 'getDecision', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-decision.fn.js')] },
        { typeName: 'Query', fieldName: 'getPendingDecisions', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-pending-decisions.fn.js')] },
        { typeName: 'Query', fieldName: 'getDecisionHistory', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-decision-history.fn.js')] },
        { typeName: 'Query', fieldName: 'getAgentInvocations', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-agent-invocations.fn.js')] },
        { typeName: 'Query', fieldName: 'getComplianceChecks', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-compliance-checks.fn.js')] },
        { typeName: 'Mutation', fieldName: 'confirmDecision', pipeline: [checkAuthPath, join(JS_FN_PATH, 'transact-confirm-decision.fn.js'), readbackPath] },
        { typeName: 'Mutation', fieldName: 'rejectDecision', pipeline: [checkAuthPath, join(JS_FN_PATH, 'transact-reject-decision.fn.js'), readbackPath] },
        { typeName: 'Mutation', fieldName: 'recordExplanationView', pipeline: [checkAuthPath, join(JS_FN_PATH, 'record-explanation-view.fn.js')] },
      ],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'advisory-bff',
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
