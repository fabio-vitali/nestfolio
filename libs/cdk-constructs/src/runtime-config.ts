import { Construct } from 'constructs';
import { CfnOutput } from 'aws-cdk-lib';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface RuntimeConfigSsmPaths {
  readonly cognitoUserPoolId: string;
  readonly cognitoClientId: string;
  readonly investorBffEndpoint: string;
  readonly advisoryBffEndpoint: string;
  readonly portfolioBffEndpoint: string;
  readonly dashboardBffEndpoint: string;
  readonly orderLedgerEndpoint: string;
}

export interface RuntimeConfigProps {
  /** S3 bucket serving the frontend assets */
  readonly assetsBucket: IBucket;
  /** SSM parameter paths for deploy-time config values */
  readonly ssmPaths: RuntimeConfigSsmPaths;
  /** AWS region for Cognito and AppSync (default: us-east-1) */
  readonly region?: string;
  /** S3 key prefix for config.json (default: assets/) */
  readonly s3KeyPrefix?: string;
}

/**
 * Reads SSM parameters at deploy time and writes a config.json to S3
 * so the Angular frontend can fetch runtime configuration.
 *
 * The generated config.json has the shape expected by the frontend
 * RuntimeConfig interface (auth + appsync sections).
 *
 * Usage in a hub stack:
 * ```ts
 * new RuntimeConfig(this, 'RuntimeConfig', {
 *   assetsBucket: frontendBucket,
 *   ssmPaths: {
 *     cognitoUserPoolId: '/nestfolio/prod/cognito/userPoolId',
 *     cognitoClientId: '/nestfolio/prod/cognito/clientId',
 *     investorBffEndpoint: '/nestfolio/prod-investor-bff/api/graphqlUrl',
 *     advisoryBffEndpoint: '/nestfolio/prod-advisory-bff/api/graphqlUrl',
 *     portfolioBffEndpoint: '/nestfolio/prod-portfolio-bff/api/graphqlUrl',
 *     dashboardBffEndpoint: '/nestfolio/prod-dashboard-bff/api/graphqlUrl',
 *     orderLedgerEndpoint: '/nestfolio/prod-order-ledger/api/graphqlUrl',
 *   },
 * });
 * ```
 */
export class RuntimeConfig extends Construct {
  constructor(scope: Construct, id: string, props: RuntimeConfigProps) {
    super(scope, id);

    const region = props.region ?? 'us-east-1';
    const prefix = props.s3KeyPrefix ?? 'assets/';

    // Resolve SSM parameters at deploy time
    const cognitoUserPoolId = StringParameter.valueForStringParameter(this, props.ssmPaths.cognitoUserPoolId);
    const cognitoClientId = StringParameter.valueForStringParameter(this, props.ssmPaths.cognitoClientId);
    const investorBffEndpoint = StringParameter.valueForStringParameter(this, props.ssmPaths.investorBffEndpoint);
    const advisoryBffEndpoint = StringParameter.valueForStringParameter(this, props.ssmPaths.advisoryBffEndpoint);
    const portfolioBffEndpoint = StringParameter.valueForStringParameter(this, props.ssmPaths.portfolioBffEndpoint);
    const dashboardBffEndpoint = StringParameter.valueForStringParameter(this, props.ssmPaths.dashboardBffEndpoint);
    const orderLedgerEndpoint = StringParameter.valueForStringParameter(this, props.ssmPaths.orderLedgerEndpoint);

    // Generate config.json content matching the frontend RuntimeConfig interface
    const configJson = JSON.stringify({
      auth: {
        userPoolId: cognitoUserPoolId,
        clientId: cognitoClientId,
        region,
      },
      appsync: {
        investorBff: { endpoint: investorBffEndpoint, region },
        portfolioBff: { endpoint: portfolioBffEndpoint, region },
        advisoryBff: { endpoint: advisoryBffEndpoint, region },
        dashboardBff: { endpoint: dashboardBffEndpoint, region },
        orderLedgerBff: { endpoint: orderLedgerEndpoint, region },
      },
    });

    new BucketDeployment(this, 'ConfigDeployment', {
      sources: [Source.data('config.json', configJson)],
      destinationBucket: props.assetsBucket,
      destinationKeyPrefix: prefix,
      prune: false,
    });

    new CfnOutput(this, 'ConfigPath', {
      value: `s3://${props.assetsBucket.bucketName}/${prefix}config.json`,
      description: 'S3 path of the frontend runtime config',
    });
  }
}
