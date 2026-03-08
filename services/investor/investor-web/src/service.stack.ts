import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { UserPool, AccountRecovery, Mfa, StringAttribute } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Distribution, ViewerProtocolPolicy, OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { createNamingService, defaultLambdaProps } from '@nestfolio/cdk-constructs';
import { join } from 'path';

export class InvestorWebStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, { subsystem: 'investor', service: 'investor-web' });
    const prefix = this.node.tryGetContext('prefix') ?? 'dev';

    // PostConfirmation Lambda
    const postConfirmation = new NodejsFunction(this, 'PostConfirmation', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'post-confirmation.ts'),
      environment: {
        BUS_NAME: naming.eventBusName(),
        SERVICE_NAME: 'investor-web',
      },
    });
    postConfirmation.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/${naming.eventBusName()}`],
    }));

    // PostAuthentication Lambda
    const postAuthentication = new NodejsFunction(this, 'PostAuthentication', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'post-authentication.ts'),
      environment: {
        BUS_NAME: naming.eventBusName(),
        SERVICE_NAME: 'investor-web',
      },
    });
    postAuthentication.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/${naming.eventBusName()}`],
    }));

    // Cognito User Pool
    const userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-investor-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OPTIONAL,
      customAttributes: {
        tenant_id: new StringAttribute({ mutable: false }),
      },
      lambdaTriggers: {
        postConfirmation,
        postAuthentication,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const client = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
    });

    // S3 bucket for static assets
    const assetsBucket = new Bucket(this, 'AssetsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution
    const oai = new OriginAccessIdentity(this, 'OAI');
    assetsBucket.grantRead(oai);
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new S3Origin(assetsBucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [{ httpStatus: 404, responsePagePath: '/index.html', responseHttpStatus: 200 }],
    });

    // SSM Parameters for cross-service discovery
    new StringParameter(this, 'UserPoolIdParam', {
      parameterName: naming.ssmParameterPath('auth/userPoolId'),
      stringValue: userPool.userPoolId,
    });
    new StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: naming.ssmParameterPath('auth/userPoolClientId'),
      stringValue: client.userPoolClientId,
    });
    new StringParameter(this, 'DistributionUrlParam', {
      parameterName: naming.ssmParameterPath('web/distributionUrl'),
      stringValue: `https://${distribution.distributionDomainName}`,
    });
  }
}
