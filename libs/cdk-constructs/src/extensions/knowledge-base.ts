import { Construct } from 'constructs';
import { RemovalPolicy, Arn, ArnFormat, Stack } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';

export interface KnowledgeBaseProps {
  /** Short name for the KB (e.g. 'regulatory', 'market', 'fund') */
  readonly kbName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Bedrock embedding model ID (default: 'amazon.titan-embed-text-v2:0') */
  readonly embeddingModelId?: string;
  /** Override bucket name (default: auto-generated from naming convention) */
  readonly bucketName?: string;
  /** Removal policy (default: RETAIN) */
  readonly removalPolicy?: RemovalPolicy;
}

export class KnowledgeBase extends Construct {
  readonly bucket: Bucket;
  readonly knowledgeBaseId: string;
  readonly dataSourceId: string;
  readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const embeddingModelId = props.embeddingModelId ?? 'amazon.titan-embed-text-v2:0';

    // Check if KB creation is disabled via CDK context
    // S3_VECTORS storage requires S3 Vector Buckets (no CF resource type yet)
    const kbEnabled = this.node.tryGetContext('kbEnabled') !== 'false';

    // ── S3 Bucket (document source — always created) ───────────────────────
    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: props.bucketName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
    });

    if (!kbEnabled) {
      // KB disabled — provide placeholder values so stacks compile
      this.knowledgeBaseId = 'KB_DISABLED';
      this.knowledgeBaseArn = `arn:aws:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:knowledge-base/KB_DISABLED`;
      this.dataSourceId = 'DS_DISABLED';
      return;
    }

    // ── IAM Role for Bedrock KB ────────────────────────────────────────────
    const kbRole = new Role(this, 'KBRole', {
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com'),
    });

    this.bucket.grantRead(kbRole);

    const embeddingModelArn = Arn.format({
      partition: 'aws',
      service: 'bedrock',
      region: Stack.of(this).region,
      account: '',
      resource: 'foundation-model',
      resourceName: embeddingModelId,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    kbRole.addToPolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [embeddingModelArn],
    }));

    // ── Bedrock Knowledge Base (L1) ────────────────────────────────────────
    // TODO: S3_VECTORS requires S3 Vector Buckets (AWS::S3::VectorBucket)
    // which have no CloudFormation resource type yet. Once CF supports them,
    // add storageConfiguration with S3_VECTORS type back.
    // For now, omit to use Bedrock's default managed storage.
    const cfnKb = new CfnKnowledgeBase(this, 'KB', {
      name: `${id}-${props.kbName}`,
      description: props.description,
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
        },
      },
    });

    this.knowledgeBaseId = cfnKb.attrKnowledgeBaseId;
    this.knowledgeBaseArn = cfnKb.attrKnowledgeBaseArn;

    // ── Bedrock Data Source ─────────────────────────────────────────────────
    const cfnDataSource = new CfnDataSource(this, 'DataSource', {
      knowledgeBaseId: this.knowledgeBaseId,
      name: `${props.kbName}-s3-source`,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: this.bucket.bucketArn,
        },
      },
    });

    this.dataSourceId = cfnDataSource.attrDataSourceId;
  }

  triggerSyncPolicy(): PolicyStatement {
    return new PolicyStatement({
      actions: ['bedrock:StartIngestionJob'],
      resources: [this.knowledgeBaseArn],
    });
  }
}
