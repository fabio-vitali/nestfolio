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
  Egress,
  Facade,
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

    applyStandardTags(this, { service: 'portfolio-bff', domain: 'execution', environment: this.node.tryGetContext('prefix') ?? 'dev' });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(eventListener);

    // Ingress: EventBridge -> SQS -> event-listener
    new Ingress(this, 'Ingress', {
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

    // Egress: DynamoDB Streams -> EventBridge publisher
    new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'portfolio-bff',
      publishableTypes: [
        'Portfolio',
        'Position',
        'CashBalance',
        'PerformanceMetric',
      ],
    });

    // GraphQL resolver Lambda
    const resolver = new NodejsFunction(this, 'GraphqlResolver', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'graphql-resolver.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(resolver);

    // Read Cognito UserPool from SSM (investor subsystem owns auth)
    const prefix = this.node.tryGetContext('prefix') ?? 'dev';
    const userPoolId = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/auth/userPoolId`,
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
