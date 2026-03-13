# Nestfolio Pipeline Infrastructure

## Quick Start

### 1. Bootstrap the GitHub OIDC Role (once per AWS account)

```bash
npx cdk deploy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  -c repo=YOUR_ORG/nestfolio
```

Note the role ARN from the output. Add it as a GitHub secret: `AWS_ROLE_ARN`.

### 2. Configure GitHub Environments

In GitHub repo Settings > Environments:

| Environment | Protection Rules |
|-------------|-----------------|
| staging | None (auto-deploys on push to main) |
| production | Required reviewers (1-5 people) |
| sandbox | None (used by PR pipelines) |

Each environment needs the `AWS_ROLE_ARN` secret.

## Deployment Paths

| Path | Trigger | Mechanism | Observability |
|------|---------|-----------|---------------|
| Manual | `bash infrastructure/scripts/deploy.sh <prefix>` | Direct stack deploys | `--no-observability` flag to disable |
| Sandbox (PR) | PR to main | `pr-deploy.yml` → `deploy.sh` | Configurable per PR |
| Staging | Push to main | `deploy.yml` → NX affected → `deploy.sh` | Enabled |
| Production | After staging | GitHub Environment approval → `deploy.sh` | Enabled |
| Hotfix | Manual dispatch | `deploy.yml` workflow_dispatch with `--services` | Enabled |

## Manual Deployment

```bash
# Deploy with observability (default)
bash infrastructure/scripts/deploy.sh dev

# Deploy without observability (lighter, cheaper)
bash infrastructure/scripts/deploy.sh dev --no-observability

# Deploy specific services only
bash infrastructure/scripts/deploy.sh dev --services="investor-bff,advisory-ctrl"

# Tear down
bash infrastructure/scripts/teardown.sh dev
```

## Service Discovery

Services are discovered from `pipeline.json` files. To add a new service to the pipeline, create a `pipeline.json` in its directory. See `.pipeline-schema.json` for the schema.

## Dependencies

The GitHub OIDC role uses standard `aws-cdk-lib/aws-iam` constructs (`OpenIdConnectProvider`, `Role`). No additional CDK libraries are required.

### Migration from cdk-pipelines-github

If the `nestfolio-github-role` stack was previously deployed using `cdk-pipelines-github`, destroy the old stack before deploying the new one:

```bash
npx cdk destroy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  nestfolio-github-role
```

Then re-deploy with the new constructs (see Quick Start above).
