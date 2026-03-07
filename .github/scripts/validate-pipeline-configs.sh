#!/usr/bin/env bash
set -euo pipefail

SCHEMA_FILE=".pipeline-schema.json"
ERRORS=0

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "ERROR: Schema file $SCHEMA_FILE not found at workspace root."
  exit 1
fi

PIPELINE_FILES=$(find services -name "pipeline.json" -type f 2>/dev/null)

if [ -z "$PIPELINE_FILES" ]; then
  echo "No pipeline.json files found in services/. Skipping validation."
  exit 0
fi

echo "Validating pipeline.json files against $SCHEMA_FILE..."

for FILE in $PIPELINE_FILES; do
  echo "  Validating $FILE..."
  if ! node -e "
    const Ajv = require('ajv');
    const fs = require('fs');
    const ajv = new Ajv({ allErrors: true });
    const schema = JSON.parse(fs.readFileSync('$SCHEMA_FILE', 'utf8'));
    const data = JSON.parse(fs.readFileSync('$FILE', 'utf8'));
    const validate = ajv.compile(schema);
    if (!validate(data)) {
      console.error('  FAIL: $FILE');
      validate.errors.forEach(e => console.error('    -', e.instancePath || '/', e.message));
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
