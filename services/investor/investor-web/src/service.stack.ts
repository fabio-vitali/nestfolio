import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { UserPool, AccountRecovery, Mfa, StringAttribute } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import {
  Distribution, ViewerProtocolPolicy, OriginAccessIdentity,
  ResponseHeadersPolicy, HeadersFrameOption, HeadersReferrerPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { join } from 'path';

export class InvestorWebStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, stateProps: false });

    // Scoped exception per spec §4: Cognito triggers are synchronous (5s timeout) and must
    // return to Cognito to complete the auth flow. The 3-tier ingestion pattern (EventBridge Rule
    // → SQS → Lambda) cannot apply because these Lambdas are invoked BY Cognito, not by EventBridge.
    // If PutEvents fails, the handler throws, failing the Cognito trigger atomically.

    // PostConfirmation Lambda
    const postConfirmation = new NodejsFunction(this, 'PostConfirmation', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'post-confirmation.ts'),
      environment: {
        BUS_NAME: this.naming.eventBusName(),
        SERVICE_NAME: 'investor-web',
      },
    });
    postConfirmation.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/${this.naming.eventBusName()}`],
    }));

    // PostAuthentication Lambda
    const postAuthentication = new NodejsFunction(this, 'PostAuthentication', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'post-authentication.ts'),
      environment: {
        BUS_NAME: this.naming.eventBusName(),
        SERVICE_NAME: 'investor-web',
      },
    });
    postAuthentication.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/${this.naming.eventBusName()}`],
    }));

    // Cognito User Pool
    const userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${this.prefix}-investor-user-pool`,
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
      removalPolicy: this.prefix === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const client = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
    });

    // S3 bucket for static assets
    const assetsBucket = new Bucket(this, 'AssetsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Security response headers policy
    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
          override: true,
        },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        contentTypeOptions: { override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.seconds(63072000),
          includeSubdomains: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    // CloudFront distribution
    const oai = new OriginAccessIdentity(this, 'OAI');
    assetsBucket.grantRead(oai);
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new S3Origin(assetsBucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
      },
      defaultRootObject: 'index.html',
      errorResponses: [{ httpStatus: 404, responsePagePath: '/index.html', responseHttpStatus: 200 }],
    });

    // SSM Parameters for cross-service discovery
    new StringParameter(this, 'UserPoolIdParam', {
      parameterName: this.naming.ssmParameterPath('auth/userPoolId'),
      stringValue: userPool.userPoolId,
    });
    new StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: this.naming.ssmParameterPath('auth/userPoolClientId'),
      stringValue: client.userPoolClientId,
    });
    new StringParameter(this, 'DistributionUrlParam', {
      parameterName: this.naming.ssmParameterPath('web/distributionUrl'),
      stringValue: `https://${distribution.distributionDomainName}`,
    });
  }
}
