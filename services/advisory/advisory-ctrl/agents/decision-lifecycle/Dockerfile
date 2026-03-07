FROM public.ecr.aws/lambda/nodejs:22

# AgentCore Runtime container for decision-lifecycle agent
# This Dockerfile is used by AgentRuntimeArtifact.fromAsset() during CDK synth.
# Full runtime setup will be completed when agents are implemented in Phase 3 Wave 3+.

WORKDIR /app
COPY package.json ./
COPY src/ ./src/

# TODO: Install dependencies and build when agent code is production-ready
# RUN npm ci && npm run build

CMD ["src/index.handler"]
