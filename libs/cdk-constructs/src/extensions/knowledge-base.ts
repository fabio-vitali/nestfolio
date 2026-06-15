import { Construct } from 'constructs';
import { RemovalPolicy, Arn, ArnFormat, Stack } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';
import { CfnVectorBucket, CfnIndex } from 'aws-cdk-lib/aws-s3vectors';
import { ServiceStack } from '../core/service-stack';

export interface KnowledgeBaseProps {
  /** Short name for the KB (e.g. 'regulatory', 'market', 'fund') */
  readonly kbName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Bedrock embedding model ID (default: 'amazon.titan-embed-text-v2:0') */
  readonly embeddingModelId?: string;
  /** Embedding vector dimension (default: 1024 for Titan Embed Text v2) */
  readonly embeddingDimension?: number;
  /** Override bucket name (default: auto-generated from naming convention) */
  readonly bucketName?: string;
  /** Removal policy (default: env-aware — RETAIN on production, DESTROY otherwise) */
  readonly removalPolicy?: RemovalPolicy;
}

export class KnowledgeBase extends Construct {
  readonly bucket: Bucket;
  readonly vectorBucket: CfnVectorBucket;
  readonly vectorIndex: CfnIndex;
  readonly knowledgeBaseId: string;
  readonly dataSourceId: string;
  readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const removalPolicy =
      props.removalPolicy ??
      (ServiceStack.productionOf(this) ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY);
    const embeddingModelId = props.embeddingModelId ?? 'amazon.titan-embed-text-v2:0';
    const embeddingDimension = props.embeddingDimension ?? 1024;

    // ── S3 Bucket (document source) ────────────────────────────────────────
    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: props.bucketName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
    });

    // ── S3 Vector Bucket + Index (embedding storage) ──────────────────────
    this.vectorBucket = new CfnVectorBucket(this, 'VectorBucket');
    this.vectorBucket.applyRemovalPolicy(removalPolicy);

    this.vectorIndex = new CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: this.vectorBucket.attrVectorBucketArn,
      dataType: 'float32',
      dimension: embeddingDimension,
      distanceMetric: 'cosine',
    });
    this.vectorIndex.applyRemovalPolicy(removalPolicy);

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

    kbRole.addToPolicy(new PolicyStatement({
      actions: [
        's3vectors:PutVectors',
        's3vectors:GetVectors',
        's3vectors:QueryVectors',
        's3vectors:DeleteVectors',
        's3vectors:GetVectorBucket',
        's3vectors:GetIndex',
      ],
      resources: [
        this.vectorBucket.attrVectorBucketArn,
        this.vectorIndex.attrIndexArn,
      ],
    }));

    // ── Bedrock Knowledge Base (L1) ────────────────────────────────────────
    // Bedrock validates storage config at creation (calls s3vectors:QueryVectors),
    // so IAM policies must exist first — add explicit dependency on the role subtree.
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
        s3VectorsConfiguration: {
          vectorBucketArn: this.vectorBucket.attrVectorBucketArn,
          indexArn: this.vectorIndex.attrIndexArn,
        },
      },
    });

    cfnKb.node.addDependency(kbRole);

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
