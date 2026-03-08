import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Facade,
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

    const prefix = this.node.tryGetContext('prefix') ?? 'dev';
    applyStandardTags(this, { service: 'dashboard-bff', domain: 'investor', environment: prefix });

    // State: DynamoDB table for all dashboard projections
    const state = new State(this, 'State');

    // Event listener Lambda — processes cross-domain events into projections
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(eventListener);

    // Ingress: investor-bus → SQS → event-listener
    // investor-bus receives forwarded events from advisory-hub and execution-hub
    new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        // Execution domain (forwarded via execution-hub → investor-bus)
        'ORDER_FILLED',
        'ORDER_PARTIALLY_FILLED',
        'CORPORATE_ACTION_APPLIED',
        'RECONCILIATION_COMPLETED',
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        // Advisory domain (forwarded via advisory-hub → investor-bus)
        'DECISION_PACKET_CREATED',
        'USER_CONFIRMATION_REQUESTED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
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

    // GraphQL resolver Lambda — serves dashboard queries
    const resolver = new NodejsFunction(this, 'GraphqlResolver', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'graphql-resolver.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadData(resolver);

    // Read Cognito UserPool from SSM
    const userPoolId = StringParameter.valueForStringParameter(
      this,
      naming.ssmParameterPath('auth/userPoolId'),
    );
    const userPool = UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    // Facade: AppSync API
    new Facade(this, 'Facade', {
      schemaPath: join(__dirname, 'schema.graphql'),
      userPool,
      resolverFunctions: { default: resolver },
    });
  }
}
