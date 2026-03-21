import { Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface StandardTagsProps {
  service: string;
  domain: string;
  environment: string;
}

/**
 * Applies standard resource tags to all resources within the given scope.
 */
export function applyStandardTags(scope: Construct, props: StandardTagsProps): void {
  Tags.of(scope).add('Service', props.service);
  Tags.of(scope).add('Domain', props.domain);
  Tags.of(scope).add('Environment', props.environment);
  Tags.of(scope).add('ManagedBy', 'CDK');
  Tags.of(scope).add('Project', 'nestfolio');
}
