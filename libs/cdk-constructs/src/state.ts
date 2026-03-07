import { Construct } from 'constructs';
import {
  Table, AttributeType, BillingMode,
  StreamViewType, ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface GsiConfig {
  indexName: string;
  partitionKey: { name: string; type: AttributeType };
  sortKey?: { name: string; type: AttributeType };
  projectionType?: ProjectionType;
}

export interface StateProps {
  /** Include S3 bucket alongside DynamoDB table */
  withBucket?: boolean;
  /** Additional GSIs beyond the two default ones */
  additionalGsis?: GsiConfig[];
}

export class State extends Construct {
  readonly table: Table;
  readonly bucket?: Bucket;

  constructor(scope: Construct, id: string, props: StateProps = {}) {
    super(scope, id);

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY, // Phase 1: DESTROY for clean teardown. Use RETAIN for production.
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
        versioned: true,
        removalPolicy: RemovalPolicy.DESTROY, // Phase 1: DESTROY for clean teardown. Use RETAIN for production.
        autoDeleteObjects: true, // Required for DESTROY policy on non-empty buckets
      });
    }
  }
}
