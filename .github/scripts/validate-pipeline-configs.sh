#!/usr/bin/env bash
set -euo pipefail

ERRORS=0

# ── Validate pipeline-defaults.json ──────────────────────────────────────

DEFAULTS_FILE="infrastructure/pipeline-defaults.json"
DEFAULTS_SCHEMA="infrastructure/pipeline-defaults-schema.json"

if [ -f "$DEFAULTS_FILE" ]; then
  echo "Validating $DEFAULTS_FILE..."
  if ! node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$DEFAULTS_FILE', 'utf8'));
    const errors = [];
    const validTiers = ['sandbox', 'staging', 'production'];
    for (const key of Object.keys(data)) {
      if (key === '\$schema') continue;
      if (!validTiers.includes(key)) errors.push('Unknown tier: ' + key);
    }
    for (const tier of validTiers) {
      if (data[tier] && typeof data[tier] !== 'object') errors.push(tier + ' must be an object or array');
    }
    if (errors.length > 0) {
      errors.forEach(e => console.error('    -', e));
      process.exit(1);
    }
    console.log('  PASS: $DEFAULTS_FILE');
  " 2>&1; then
    ERRORS=$((ERRORS + 1))
    echo "  FAIL: $DEFAULTS_FILE"
  fi
else
  echo "INFO: $DEFAULTS_FILE not found — using hardcoded fallbacks only."
fi

# ── Validate per-service pipeline.json files ─────────────────────────────

OVERRIDE_SCHEMA=".pipeline-schema.json"
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/.*" -type f 2>/dev/null || true)

if [ -z "$PIPELINE_FILES" ]; then
  echo "No per-service pipeline.json overrides found."
else
  echo ""
  echo "Validating per-service pipeline.json overrides..."
  for FILE in $PIPELINE_FILES; do
    echo "  Validating $FILE..."
    if ! node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$FILE', 'utf8'));
      const errors = [];
      const validKeys = ['\$schema', 'deploymentPhase', 'parallelDeploy', 'dependencies', 'observability', 'logRetention', 'protectedResources', 'alarmActions', 'sandbox', 'staging', 'production'];
      for (const key of Object.keys(data)) {
        if (!validKeys.includes(key)) errors.push('Unknown key: ' + key);
      }
      if (data.deploymentPhase !== undefined && (!Number.isInteger(data.deploymentPhase) || data.deploymentPhase < 1 || data.deploymentPhase > 3)) {
        errors.push('deploymentPhase must be 1-3');
      }
      if (data.parallelDeploy !== undefined && typeof data.parallelDeploy !== 'boolean') {
        errors.push('parallelDeploy must be a boolean');
      }
      if (data.dependencies !== undefined && !Array.isArray(data.dependencies)) {
        errors.push('dependencies must be an array');
      }
      if (data.logRetention !== undefined && (!Number.isInteger(data.logRetention) || data.logRetention < 1)) {
        errors.push('logRetention must be a positive integer');
      }
      if (errors.length > 0) {
        errors.forEach(e => console.error('    -', e));
        process.exit(1);
      }
      console.log('  PASS: $FILE');
    " 2>&1; then
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

# ── Summary ──────────────────────────────────────────────────────────────

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "ERROR: $ERRORS file(s) failed validation."
  exit 1
fi
echo "All pipeline configuration files are valid."
