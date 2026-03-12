import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
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

export class OrderLedgerBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'order-ledger-bff',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'order-ledger-bff', domain: 'execution', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda (actual + simulation events)
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'order-ledger-bff' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({ actions: ['events:PutEvents'], resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`] }));

    // Ingress: All events from execution bus (actual + simulation)
    const executionBus = EventBus.fromEventBusName(this, 'ExecutionBus', naming.eventBusName());
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: executionBus,
      eventTypes: [
        'ORDER_FILLED',
        'ORDER_PARTIALLY_FILLED',
        'ORDER_REJECTED',
        'ORDER_CANCELLED',
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        'DECISION_PACKET_CREATED',
      ],
      handler: eventListener,
    });

    // Scoped exception per spec §4: The reducer is a 3rd Lambda (beyond the 2-Lambda maximum)
    // required by the CQRS/Event Sourcing pattern. It is a DynamoDB Stream consumer that
    // materializes portfolio/position snapshots from LedgerEntry records. It does not receive
    // events from the bus and does not publish events directly — Egress handles outbound publication.
    const reducerFn = new NodejsFunction(this, 'ReducerFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: { TABLE_NAME: state.table.tableName, SERVICE_NAME: 'order-ledger-bff' },
    });
    state.table.grantReadWriteData(reducerFn);

    // DDB Stream event source: filtered to LedgerEntry __typename only (prevents infinite loop)
    reducerFn.addEventSource(new DynamoEventSource(state.table, {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(5),
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('LedgerEntry') },
            },
          },
        }),
      ],
    }));

    // Egress: publishes PositionSnapshot and PortfolioSnapshot to EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'order-ledger-bff',
      publishableTypes: ['PositionSnapshot', 'PortfolioSnapshot'],
    });

    // GraphQL resolver Lambda
    const resolver = new NodejsFunction(this, 'GraphqlResolver', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'graphql-resolver.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'order-ledger-bff' },
    });
    state.table.grantReadWriteData(resolver);
    resolver.addToRolePolicy(new PolicyStatement({ actions: ['events:PutEvents'], resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`] }));

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
      table: state.table,
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'getLedgerPortfolio',
          pipeline: [
            checkAuthPath,
            join(JS_FN_PATH, 'get-ledger-portfolio-snapshot.fn.js'),
            join(JS_FN_PATH, 'get-ledger-portfolio-positions.fn.js'),
          ],
        },
        {
          typeName: 'Query',
          fieldName: 'getOrderHistory',
          pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-order-history.fn.js')],
        },
        {
          typeName: 'Query',
          fieldName: 'getTimeTravelAvailability',
          pipeline: [
            checkAuthPath,
            join(JS_FN_PATH, 'get-time-travel-earliest.fn.js'),
            join(JS_FN_PATH, 'get-time-travel-latest.fn.js'),
          ],
        },
      ],
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'getPortfolioAt', handler: resolver },
        { typeName: 'Query', fieldName: 'getSimulationComparison', handler: resolver },
      ],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener, reducerFn, resolver],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'order-ledger-bff',
      lambdaFunctions: [eventListener, reducerFn, resolver],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
