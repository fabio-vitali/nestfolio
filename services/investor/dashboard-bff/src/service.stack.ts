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
  Facade,
  Monitoring,
  ServiceDashboard,
  createNamingService,
  defaultLambdaProps,
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class DashboardBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'dashboard-bff',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'dashboard-bff', domain: 'investor', environment: prefix });

    // State: DynamoDB table for all dashboard projections
    const state = new State(this, 'State');

    // Event listener Lambda — processes cross-domain events into projections
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'dashboard-bff' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`],
    }));

    // Ingress: investor-bus → SQS → event-listener
    // investor-bus receives forwarded events from advisory-hub and execution-hub
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        // Ledger domain (forwarded via ledger-hub → investor-bus)
        'BALANCE_UPDATED',
        'PORTFOLIO_UPDATED',
        'RECONCILIATION_COMPLETED',
        // Advisory domain (forwarded via advisory-hub → investor-bus)
        'DECISION_PACKET_CREATED',
        'USER_CONFIRMATION_REQUESTED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        // Ledger events (forwarded from ledger-hub → investor-bus)
        'LEDGER_ENTRY_RECORDED',
        // Investor domain (native on investor-bus)
        'ONBOARDING_COMPLETED',
        'GOAL_SET',
        'GOAL_UPDATED',
        'RISK_PROFILE_SET',
        'RISK_PROFILE_UPDATED',
      ],
      handler: eventListener,
    });

    // No Egress — dashboard-bff is a pure read-model, does not publish domain events

    // Read Cognito UserPool from SSM
    const userPoolId = StringParameter.valueForStringParameter(
      this,
      naming.ssmParameterPath('auth/userPoolId'),
    );
    const userPool = UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    const JS_FN_PATH = join(__dirname, 'graphql', 'js-function');
    const checkAuthPath = join(JS_FN_PATH, 'utils', 'check-auth.fn.js');

    // Facade: AppSync API with JS pipeline resolvers
    new Facade(this, 'Facade', {
      schemaPath: join(__dirname, 'schema.graphql'),
      userPool,
      table: state.table,
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'getDashboard',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-dashboard.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getPositionSnapshots',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-position-snapshots.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getRecentActivity',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-recent-activity.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getTimeTravelAvailability',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-time-travel-availability.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getSimulationSummary',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-simulation-summary.fn.js')],
        },
      ],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'dashboard-bff',
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq],
    });
  }
}
