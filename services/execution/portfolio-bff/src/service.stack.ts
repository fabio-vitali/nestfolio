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

export class PortfolioBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'portfolio-bff',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'portfolio-bff', domain: 'execution', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'portfolio-bff' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({ actions: ['events:PutEvents'], resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`] }));

    // Ingress: EventBridge -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'ExecutionBus', naming.eventBusName()),
      eventTypes: [
        'ORDER_FILLED',
        'ORDER_PARTIALLY_FILLED',
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'CORPORATE_ACTION_APPLIED',
        'RECONCILIATION_COMPLETED',
      ],
      handler: eventListener,
    });

    // No Egress — portfolio-bff is a pure read-model BFF. Portfolio/Position/CashBalance/PerformanceMetric
    // publication is owned by portfolio-ctrl (the domain controller).

    // Read Cognito UserPool from SSM (investor subsystem owns auth)
    const userPoolId = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/auth/userPoolId`,
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
          fieldName: 'getPortfolio',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-portfolio.fn.js'), join(JS_FN_PATH, 'create-portfolio.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getPositions',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-positions.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getCashBalance',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-cash-balance.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getPerformance',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-performance.fn.js')],
          dataSource: 'none',
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
      serviceName: 'portfolio-bff',
      lambdaFunctions: [eventListener],
      dlqs: [ingress.dlq],
    });
  }
}
