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
} from '@nestfolio/cdk-constructs';

export class InvestorBffStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-bff',
    });

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
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        'USER_REGISTERED',
        'NOTIFICATION_CREATED',
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        'WITHDRAWAL_REJECTED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge publisher
    new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'investor-bff',
      publishableTypes: [
        'Goal',
        'RiskProfile',
        'Mandate',
        'OperatingModeRecord',
        'InvestorProfile',
      ],
    });

    // GraphQL resolver Lambda
    const resolver = new NodejsFunction(this, 'GraphqlResolver', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'graphql-resolver.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadWriteData(resolver);

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
