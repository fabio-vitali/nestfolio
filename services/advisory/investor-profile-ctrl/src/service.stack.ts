import { StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  ServiceStack,
  Ingress,
  Egress,
  AgentRuntime,
  defaultLambdaProps,
  NamingService,
} from '@nestfolio/cdk-constructs';

export class InvestorProfileCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'investor-profile-ctrl',
      serviceDir: __dirname,
    });

    // KB S3 bucket (Regulatory & Compliance)
    const kbBucket = new Bucket(this, 'KbBucket', {
      bucketName: `${this.account}-${props.prefix}-nestfolio-kb-regulatory`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Ingress: trigger event + KB ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['ANALYZE_INVESTOR_PROFILE', 'DECISION_BLOCKED', 'DECISION_APPROVED'],
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
      handlerEntry: join(__dirname, 'handlers/event-publisher-cdc.ts'),
    });

    // KB ingestion Lambda (separate from event-listener)
    const kbIngestionFn = new NodejsFunction(this, 'KBIngestion', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kbBucket.bucketName,
        TABLE_NAME: this.state.getTable().tableName,
        BUS_NAME: this.eventBus.eventBusName,
      },
    });
    kbBucket.grantWrite(kbIngestionFn);
    kbIngestionFn.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['bedrock:StartIngestionJob'],
      resources: ['*'],
    }));

    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelOpusId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/opus'));
    const modelHaikuId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/haiku'));

    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
    ingress.handler.addEnvironment('MODEL_HAIKU_SSM', hubNaming.ssmParameterPath('models/haiku'));

    // AgentRuntime (no tool Lambdas for this service — RAG only)
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'user-goals (Haiku) + risk-assessment (Opus) parallel orchestration',
      tables: [this.state.getTable()],
      modelIds: [modelOpusId, modelHaikuId],
      toolTargets: [],
    });

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelHaikuId],
    });
  }
}
