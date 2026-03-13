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

### 3. Synth and Commit the Pipeline

```bash
npx nx run pipeline:synth -- -c account=$(aws sts get-caller-identity --query Account --output text) -c region=us-east-1
git add .github/workflows/deploy.yml
git commit -m "ci: update generated pipeline workflow"
git push
```

## Deployment Paths

| Path | Trigger | Mechanism | Observability |
|------|---------|-----------|---------------|
| Manual | `bash deploy-all.sh <prefix>` | Direct stack deploys | `--no-observability` flag to disable |
| Sandbox (PR) | PR to main | `pr-deploy.yml` -> `deploy-all.sh` | Configurable per PR |
| Staging | Push to main | CDK-generated `deploy.yml` | Enabled |
| Production | After staging | GitHub Environment approval | Enabled |

## Manual Deployment

```bash
# Deploy with observability (default)
bash deploy-all.sh dev

# Deploy without observability (lighter, cheaper)
bash deploy-all.sh dev --no-observability

# Tear down
bash destroy-all.sh dev
```

## Re-generating the Pipeline

After changing `pipeline.app.ts` or adding new services:

```bash
npx nx run pipeline:synth -- -c account=<ACCOUNT> -c region=us-east-1
# Commit the regenerated deploy.yml
```

## Service Discovery

Services are discovered from `pipeline.json` files. To add a new service to the pipeline, create a `pipeline.json` in its directory. See `.pipeline-schema.json` for the schema.
