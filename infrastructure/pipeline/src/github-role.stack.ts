import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import {
  OpenIdConnectProvider,
  OpenIdConnectPrincipal,
  Role,
  ManagedPolicy,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubRoleStackProps extends StackProps {
  repos: string[];
}

export class GitHubRoleStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubRoleStackProps) {
    super(scope, id, props);

    const provider = new OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const role = new Role(this, 'GitHubRole', {
      roleName: 'nestfolio-github-actions-role',
      assumedBy: new OpenIdConnectPrincipal(provider, {
        StringLike: {
          'token.actions.githubusercontent.com:sub': props.repos.map(
            (repo) => `repo:${repo}:*`,
          ),
        },
      }),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    new CfnOutput(this, 'RoleArn', {
      value: role.roleArn,
      description: 'ARN of the GitHub Actions OIDC role',
    });
  }
}
