import { S3Client } from '@aws-sdk/client-s3';

export abstract class BucketRepository {
  protected readonly client: S3Client;

  constructor(protected readonly bucketName: string) {
    this.client = new S3Client({});
  }
}
