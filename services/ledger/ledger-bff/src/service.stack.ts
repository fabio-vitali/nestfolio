import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, Ingress, Facade, discoverJsResolvers, defaultLambdaProps, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs';

export class LedgerBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const domainAccounts = getDomainAccounts(this);
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', this.prefix, 'ledger', domainAccounts);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'BALANCE_UPDATED',
        'PORTFOLIO_UPDATED',
        'LEDGER_ENTRY_RECORDED',
      ],
      environment: {
        SNAPSHOT_HISTORY_TTL_DAYS: '365',
      },
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
