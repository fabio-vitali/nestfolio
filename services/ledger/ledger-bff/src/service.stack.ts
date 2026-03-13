import { StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, Ingress, Facade, discoverJsResolvers, defaultLambdaProps } from '@nestfolio/cdk-constructs';

export class LedgerBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'ledger', service: 'ledger-bff', serviceDir: __dirname });

    const ledgerBusArn = StringParameter.valueForStringParameter(this, `/nestfolio/${this.prefix}-ledger/event-hub/busArn`);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'BALANCE_UPDATED',
        'PORTFOLIO_UPDATED',
        'LEDGER_ENTRY_RECORDED',
      ],
    });

    // GraphQL resolver Lambda (handles getPortfolioAt + getSimulationComparison)
    const resolver = new NodejsFunction(this, 'GraphqlResolver', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'graphql-resolver.ts'),
      environment: {
        TABLE_NAME: this.state.getTable().tableName,
        BUS_NAME: this.eventBus.eventBusName,
        SERVICE_NAME: 'ledger-bff',
      },
    });
    this.state.getTable().grantReadWriteData(resolver);
    resolver.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [ledgerBusArn],
    }));

    new Facade(this, 'Facade', {
      userPoolSsmPath: `/nestfolio/${this.prefix}-investor/auth/userPoolId`,
      jsResolvers: discoverJsResolvers(__dirname, { exclude: ['getPortfolioAt', 'getSimulationComparison'] }),
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'getPortfolioAt', handler: resolver },
        { typeName: 'Query', fieldName: 'getSimulationComparison', handler: resolver },
      ],
    });

    this.addObservability({ ingress, extraLambdas: [resolver] });
  }
}
