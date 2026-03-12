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

export class LedgerBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'ledger-bff',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'ledger-bff', domain: 'ledger', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Look up ledger-hub bus ARN from SSM
    const ledgerBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-ledger/event-hub/busArn`,
    );
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingress: Events from ledger-hub
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: ledgerBus,
      eventTypes: [
        'BALANCE_UPDATED',
        'PORTFOLIO_UPDATED',
        'LEDGER_ENTRY_RECORDED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'ledger-bff',
      state,
    });

    // GraphQL resolver Lambda (handles getPortfolioAt + getSimulationComparison)
    const resolver = new NodejsFunction(this, 'GraphqlResolver', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'graphql-resolver.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        BUS_NAME: ledgerBus.eventBusName,
        SERVICE_NAME: 'ledger-bff',
      },
    });
    state.getTable().grantReadWriteData(resolver);
    resolver.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [ledgerBusArn],
    }));

    // Read Cognito UserPool from SSM (investor subsystem owns auth)
    const userPoolId = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/auth/userPoolId`,
    );
    const userPool = UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    const JS_FN_PATH = join(__dirname, 'graphql', 'js-function');
    const checkAuthPath = join(JS_FN_PATH, 'utils', 'check-auth.fn.js');

    // Facade: AppSync API — hybrid JS + Lambda resolvers
    new Facade(this, 'Facade', {
      schemaPath: join(__dirname, 'schema.graphql'),
      userPool,
      table: state.getTable(),
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'getBalance',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-balance.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getPortfolio',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-portfolio.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getPositions',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-positions.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getPerformance',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-performance.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getOrderHistory',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-order-history.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getTimeTravelAvailability',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-time-travel-availability.fn.js')],
        },
      ],
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'getPortfolioAt', handler: resolver },
        { typeName: 'Query', fieldName: 'getSimulationComparison', handler: resolver },
      ],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [ingress.handler, resolver],
      dlqs: [ingress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'ledger-bff',
      lambdaFunctions: [ingress.handler, resolver],
      dlqs: [ingress.dlq],
    });
  }
}
