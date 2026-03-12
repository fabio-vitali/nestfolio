import { Construct } from 'constructs';
import {
  Table, AttributeType, BillingMode,
  StreamViewType, ProjectionType, TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface GsiConfig {
  indexName: string;
  partitionKey: { name: string; type: AttributeType };
  sortKey?: { name: string; type: AttributeType };
  projectionType?: ProjectionType;
}

export interface StateProps {
  /** Include DynamoDB table (default: true) */
  withTable?: boolean;
  /** Include S3 bucket alongside DynamoDB table */
  withBucket?: boolean;
  /** Additional GSIs beyond the two default ones */
  additionalGsis?: GsiConfig[];
  /** Removal policy for DynamoDB table and S3 bucket (default: RETAIN) */
  removalPolicy?: RemovalPolicy;
  /** DynamoDB encryption type (default: AWS_MANAGED) */
  encryption?: TableEncryption;
}

export class State extends Construct {
  readonly table?: Table;
  readonly bucket?: Bucket;

  constructor(scope: Construct, id: string, props: StateProps = {}) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const withTable = props.withTable ?? true;

    if (!withTable) {
      if (props.withBucket) {
        this.bucket = new Bucket(this, 'Bucket', {
          encryption: BucketEncryption.S3_MANAGED,
          blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
          versioned: true,
          removalPolicy,
          autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
        });
      }
      return;
    }

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: props.encryption ?? TableEncryption.AWS_MANAGED,
      removalPolicy,
    });

    // GSI 1: Tenant queries -- all entities for a tenant
    this.table.addGlobalSecondaryIndex({
      indexName: 'tenantId-index',
      partitionKey: { name: 'tenantId', type: AttributeType.STRING },
      sortKey: { name: '__typename', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 2: Time-based queries -- per entity type
    this.table.addGlobalSecondaryIndex({
      indexName: 'typename-timestamp-index',
      partitionKey: { name: '__typename', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    // Additional GSIs if provided
    if (props.additionalGsis) {
      for (const gsi of props.additionalGsis) {
        this.table.addGlobalSecondaryIndex({
          indexName: gsi.indexName,
          partitionKey: gsi.partitionKey,
          sortKey: gsi.sortKey,
          projectionType: gsi.projectionType ?? ProjectionType.ALL,
        });
      }
    }

    if (props.withBucket) {
      this.bucket = new Bucket(this, 'Bucket', {
        encryption: BucketEncryption.S3_MANAGED,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        versioned: true,
        removalPolicy,
        autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      });
    }
  }

  /** Returns the DynamoDB table. Throws if withTable was false. */
  getTable(): Table {
    if (!this.table) {
      throw new Error('State was created without a table (withTable: false)');
    }
    return this.table;
  }

  /** Returns the S3 bucket. Throws if withBucket was false. */
  getBucket(): Bucket {
    if (!this.bucket) {
      throw new Error('State was created without a bucket (withBucket: false)');
    }
    return this.bucket;
  }
}
