import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { GitHubActionRole } from 'cdk-pipelines-github';

export interface GitHubRoleStackProps extends StackProps {
  repos: string[];
}

export class GitHubRoleStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubRoleStackProps) {
    super(scope, id, props);

    const role = new GitHubActionRole(this, 'GitHubRole', {
      repos: props.repos,
      roleName: 'nestfolio-github-actions-role',
    });

    new CfnOutput(this, 'RoleArn', {
      value: role.role.roleArn,
      description: 'ARN of the GitHub Actions OIDC role',
    });
  }
}
