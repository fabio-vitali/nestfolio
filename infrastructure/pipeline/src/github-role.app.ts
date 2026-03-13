import { App } from 'aws-cdk-lib';
import { GitHubRoleStack } from './github-role.stack';

const app = new App();
const repo = app.node.tryGetContext('repo');
if (!repo) throw new Error('Pass -c repo=org/nestfolio');

new GitHubRoleStack(app, 'nestfolio-github-role', {
  repos: [repo],
  env: { region: 'us-east-1' },
});

app.synth();
