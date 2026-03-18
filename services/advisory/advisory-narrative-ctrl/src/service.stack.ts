import { RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  ServiceStack,
  ServiceStackProps,
  Ingress,
  Egress,
  AgentRuntime,
  NamingService,
} from '@nestfolio/cdk-constructs';

export class AdvisoryNarrativeCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // KB S3 bucket (Explainability Feedback)
    const kbBucket = new Bucket(this, 'KbBucket', {
      bucketName: `${this.account}-${props.prefix}-nestfolio-kb-explainability`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Ingress: trigger + feedback events
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['GENERATE_NARRATIVE', 'DECISION_FEEDBACK'],
    });

    // Grant KB bucket access to the ingress handler (for feedback-correlator inline)
    kbBucket.grantReadWrite(ingress.handler);
    ingress.handler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['bedrock:StartIngestionJob'],
      resources: ['*'],
    }));
    ingress.handler.addEnvironment('KB_BUCKET', kbBucket.bucketName);

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
    });

    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));

    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));

    // AgentRuntime (no tool Lambdas — all context arrives in event payload)
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_narrative_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'explainability (Sonnet, 8192 tokens) agent with feedback loop KB',
      tables: [this.state.getTable()],
      modelIds: [modelSonnetId],
      toolTargets: [],
    });

    this.addObservability({
      ingress,
      egress,
      monitorBedrock: true,
      bedrockModelIds: [modelSonnetId],
    });
  }
}
