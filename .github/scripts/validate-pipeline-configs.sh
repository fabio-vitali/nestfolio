#!/usr/bin/env bash
set -euo pipefail

SCHEMA_FILE=".pipeline-schema.json"
ERRORS=0

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "ERROR: Schema file $SCHEMA_FILE not found at workspace root."
  exit 1
fi

PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/.*" -type f 2>/dev/null)

if [ -z "$PIPELINE_FILES" ]; then
  echo "No pipeline.json files found in services/. Skipping validation."
  exit 0
fi

# Read allowed subsystems from schema
ALLOWED_SUBSYSTEMS=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SCHEMA_FILE','utf8'));
  console.log(JSON.stringify(s.properties.subsystem.enum));
")

echo "Validating pipeline.json files against $SCHEMA_FILE..."

for FILE in $PIPELINE_FILES; do
  echo "  Validating $FILE..."
  if ! node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$FILE', 'utf8'));
    const allowed = $ALLOWED_SUBSYSTEMS;
    const errors = [];
    if (typeof data.service !== 'string' || !data.service) errors.push('service must be a non-empty string');
    if (!allowed.includes(data.subsystem)) errors.push('subsystem must be one of: ' + allowed.join(', '));
    if (!Number.isInteger(data.deploymentPhase) || data.deploymentPhase < 1 || data.deploymentPhase > 3) errors.push('deploymentPhase must be 1-3');
    if (!data.production || !Array.isArray(data.production.regions) || typeof data.production.parallelDeploy !== 'boolean') errors.push('production must have regions[] and parallelDeploy boolean');
    if (data.dependencies && !Array.isArray(data.dependencies)) errors.push('dependencies must be an array');
    if (errors.length > 0) {
      errors.forEach(e => console.error('    -', e));
      console.error('  FAIL: $FILE');
      process.exit(1);
    }
    console.log('  PASS: $FILE');
  " 2>&1; then
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "ERROR: $ERRORS pipeline.json file(s) failed validation."
  exit 1
fi

echo ""
echo "All pipeline.json files are valid."
