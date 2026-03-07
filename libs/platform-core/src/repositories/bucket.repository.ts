import { S3Client } from '@aws-sdk/client-s3';

/**
 * Abstract base class for S3 bucket repositories.
 * Concrete repositories extend this with domain-specific storage methods.
 */
export abstract class BucketRepository {
  protected readonly client: S3Client;

  constructor(protected readonly bucketName: string) {
    this.client = new S3Client({});
  }
}
