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

export class InvestorBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-bff',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'investor-bff', domain: 'investor', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'investor-bff' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`],
    }));

    // Ingress: EventBridge -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        'USER_REGISTERED',
        'NOTIFICATION_CREATED',
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        'WITHDRAWAL_REJECTED',
        'ORDER_FILLED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'investor-bff',
      publishableTypes: [
        'Goal',
        'RiskProfile',
        'Mandate',
        'OperatingModeRecord',
        'InvestorProfile',
        'Deposit',
        'Withdrawal',
      ],
      customEventTypeMap: {
        'Deposit:INSERT': 'DEPOSIT_INITIATED',
        'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
      },
    });

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
        // Queries
        { typeName: 'Query', fieldName: 'getProfile', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-profile.fn.js')] },
        { typeName: 'Query', fieldName: 'getGoals', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-goals.fn.js')] },
        { typeName: 'Query', fieldName: 'getNotifications', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-notifications.fn.js')] },
        { typeName: 'Query', fieldName: 'getUnreadCount', pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-unread-count.fn.js')] },
        // Mutations
        { typeName: 'Mutation', fieldName: 'markNotificationRead', pipeline: [checkAuthPath, join(JS_FN_PATH, 'mark-notification-read.fn.js')] },
        { typeName: 'Mutation', fieldName: 'recordOnboardingAnswer', pipeline: [checkAuthPath, join(JS_FN_PATH, 'record-onboarding-answer.fn.js')], dataSource: 'none' },
        { typeName: 'Mutation', fieldName: 'requestAccountClosure', pipeline: [checkAuthPath, join(JS_FN_PATH, 'request-account-closure.fn.js')], dataSource: 'none' },
        { typeName: 'Mutation', fieldName: 'initiateDeposit', pipeline: [checkAuthPath, join(JS_FN_PATH, 'initiate-deposit.fn.js')] },
        { typeName: 'Mutation', fieldName: 'requestWithdrawal', pipeline: [checkAuthPath, join(JS_FN_PATH, 'request-withdrawal.fn.js')] },
        { typeName: 'Mutation', fieldName: 'setGoal', pipeline: [checkAuthPath, join(JS_FN_PATH, 'set-goal.fn.js')] },
        { typeName: 'Mutation', fieldName: 'updateGoal', pipeline: [checkAuthPath, join(JS_FN_PATH, 'update-goal.fn.js')] },
        { typeName: 'Mutation', fieldName: 'setRiskProfile', pipeline: [checkAuthPath, join(JS_FN_PATH, 'set-risk-profile.fn.js')] },
        { typeName: 'Mutation', fieldName: 'grantMandate', pipeline: [checkAuthPath, join(JS_FN_PATH, 'grant-mandate.fn.js')] },
        { typeName: 'Mutation', fieldName: 'updateMandate', pipeline: [checkAuthPath, join(JS_FN_PATH, 'update-mandate.fn.js')] },
        { typeName: 'Mutation', fieldName: 'revokeMandate', pipeline: [checkAuthPath, join(JS_FN_PATH, 'revoke-mandate.fn.js')] },
        { typeName: 'Mutation', fieldName: 'selectOperatingMode', pipeline: [checkAuthPath, join(JS_FN_PATH, 'select-operating-mode.fn.js')] },
      ],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'investor-bff',
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
