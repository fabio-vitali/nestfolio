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

    // ── S3 Bucket (document source) ────────────────────────────────────────
    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: props.bucketName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
    });

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

    // ── Bedrock Knowledge Base (L1) — S3 Vectors (managed, no external DB) ─
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
      storageConfiguration: {
        type: 'S3_VECTORS',
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
