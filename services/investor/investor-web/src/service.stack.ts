import { RemovalPolicy, Duration, Fn } from 'aws-cdk-lib';
import { UserPool, AccountRecovery, Mfa, StringAttribute } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import {
  Distribution, ViewerProtocolPolicy, OriginAccessIdentity,
  ResponseHeadersPolicy, HeadersFrameOption, HeadersReferrerPolicy,
  Function as CfFunction, FunctionCode, FunctionEventType,
  OriginRequestPolicy, OriginRequestHeaderBehavior, OriginRequestCookieBehavior,
  OriginRequestQueryStringBehavior, AllowedMethods,
  CachePolicy, CacheHeaderBehavior, CacheQueryStringBehavior, CacheCookieBehavior,
  ResponseHeadersCorsBehavior,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MFE_CATALOG } from './mfe-catalog';
import { addMfeBucketBehavior, addGraphqlBehavior } from './b1-topology';

export class InvestorWebStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

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
      authFlows: { userPassword: true, userSrp: true, adminUserPassword: true },
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
    // CSP is single-sourced from apps/nestfolio-host/csp.txt (charter §5 row 8, Pillar 5).
    const cspContent = readFileSync(
      join(__dirname, '../../../../apps/nestfolio-host/csp.txt'),
      'utf-8',
    ).trim();

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: cspContent,
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

    // Upload the built nestfolio-host shell to the assets bucket. The build must be run
    // before `cdk deploy` — the deploy script handles this. CloudFront's 404→/index.html
    // error response takes care of SPA routing.
    new BucketDeployment(this, 'ShellDeployment', {
      sources: [Source.asset(join(__dirname, '../../../../dist/apps/nestfolio-host/browser'))],
      destinationBucket: assetsBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // ─── CopilotKit bridge: /api/copilotkit* → AgentCore runtime ───────────────
    // Deploy-order contract: `onboarding-bff` must be deployed first so this
    // SSM parameter exists. Per-service CDK apps, so `stack.addDependency(...)`
    // is not available.
    const onboardingRuntimeArn = StringParameter.valueForStringParameter(
      this, `/nestfolio/${this.prefix}-onboarding-bff/agent/runtimeUrl`,
    );

    const cfFunctionTemplate = readFileSync(
      join(__dirname, 'cf-functions', 'copilot-rewrite.js'), 'utf-8',
    );
    const cfFunctionCode = Fn.sub(cfFunctionTemplate.replace(/__RUNTIME_ARN__/g, '${arn}'), {
      arn: onboardingRuntimeArn,
    });

    const copilotRewriteFn = new CfFunction(this, 'CopilotRewriteFn', {
      functionName: `${this.prefix}-investor-web-copilot-rewrite`,
      code: FunctionCode.fromInline(cfFunctionCode),
      comment: 'Rewrites /api/copilotkit* → /runtimes/<arn>/invocations?qualifier=DEFAULT',
    });

    // `Authorization` cannot be forwarded via OriginRequestPolicy — CF requires
    // it to be attached to a CachePolicy (so it becomes part of the cache key).
    // Effective caching is moot: CopilotKit is a streaming POST, and CloudFront
    // never caches POSTs. The 1-second maxTtl is required because CloudFormation
    // rejects `HeaderBehavior` on policies where all TTLs are 0.
    const copilotCachePolicy = new CachePolicy(this, 'CopilotCachePolicy', {
      cachePolicyName: `${this.prefix}-investor-web-copilot-cache`,
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(1),
      headerBehavior: CacheHeaderBehavior.allowList('Authorization'),
      cookieBehavior: CacheCookieBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
    });

    const copilotOriginRequestPolicy = new OriginRequestPolicy(this, 'CopilotOriginRequestPolicy', {
      originRequestPolicyName: `${this.prefix}-investor-web-copilot-origin-req`,
      headerBehavior: OriginRequestHeaderBehavior.allowList(
        'Content-Type', 'x-amzn-bedrock-agentcore-runtime-session-id',
      ),
      cookieBehavior: OriginRequestCookieBehavior.none(),
      queryStringBehavior: OriginRequestQueryStringBehavior.none(),
    });

    const copilotResponseHeadersPolicy = new ResponseHeadersPolicy(this, 'CopilotResponseHeadersPolicy', {
      responseHeadersPolicyName: `${this.prefix}-investor-web-copilot-cors`,
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: [
          'Authorization', 'Content-Type', 'x-amzn-bedrock-agentcore-runtime-session-id',
        ],
        accessControlAllowMethods: ['POST', 'OPTIONS'],
        // Same-origin (the distribution itself) requests bypass CORS — don't
        // self-reference to avoid a ResponseHeadersPolicy → Distribution cycle.
        // For custom-domain deploys, append the custom domain here.
        accessControlAllowOrigins: ['http://localhost:4200'],
        accessControlExposeHeaders: ['Content-Type'],
        originOverride: true,
      } satisfies ResponseHeadersCorsBehavior,
    });

    distribution.addBehavior('/api/copilotkit*', new HttpOrigin('bedrock-agentcore.us-east-1.amazonaws.com'), {
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: copilotCachePolicy,
      originRequestPolicy: copilotOriginRequestPolicy,
      responseHeadersPolicy: copilotResponseHeadersPolicy,
      functionAssociations: [{ function: copilotRewriteFn, eventType: FunctionEventType.VIEWER_REQUEST }],
    });

    // ─── B1: unified topology (flag-gated) ─────────────────────────────────
    // Charter §5 row 9a + §7 R6: per-domain /mfe/<key>/*, /graphql/<domain>,
    // and /realtime/<domain> behaviors discovered via SSM. Cold-start: flag
    // is false on first deploy (BFF SSM exports don't exist yet); deploy.sh
    // re-deploys investor-web with mfeBehaviors=true after BFFs are deployed.
    const mfeBehaviorsEnabled = this.node.tryGetContext('mfeBehaviors') === 'true';
    if (mfeBehaviorsEnabled) {
      const realtimeRewriteFn = new CfFunction(this, 'RealtimeRewriteFn', {
        functionName: `${this.prefix}-investor-web-realtime-rewrite`,
        code: FunctionCode.fromInline(
          readFileSync(join(__dirname, 'cf-functions', 'realtime-rewrite.js'), 'utf-8'),
        ),
        comment: 'Rewrites /realtime/<domain> and /graphql/<domain> to /graphql',
      });

      for (const entry of MFE_CATALOG) {
        addMfeBucketBehavior(this, distribution, this.prefix, entry);
        if (entry.hasFacade) {
          addGraphqlBehavior(this, distribution, this.prefix, entry, realtimeRewriteFn);
        }
      }
    }

    // SSM Parameters for cross-service discovery
    new StringParameter(this, 'UserPoolIdParam', {
      parameterName: this.naming.ssmParameterPath('auth/userPoolId'),
      stringValue: userPool.userPoolId,
    });
    new StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: this.naming.ssmParameterPath('auth/userPoolClientId'),
      stringValue: client.userPoolClientId,
    });
    new StringParameter(this, 'AuthRegionParam', {
      parameterName: this.naming.ssmParameterPath('auth/region'),
      stringValue: this.region,
    });
    new StringParameter(this, 'DistributionUrlParam', {
      parameterName: this.naming.ssmParameterPath('web/distributionUrl'),
      stringValue: `https://${distribution.distributionDomainName}`,
    });
    new StringParameter(this, 'DistributionIdParam', {
      parameterName: this.naming.ssmParameterPath('web/distributionId'),
      stringValue: distribution.distributionId,
    });
  }
}
