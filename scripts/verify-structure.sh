#!/usr/bin/env bash
set -euo pipefail

# Pre-commit structural verification for Nestfolio services
# Scoped to services with staged changes only

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

CHANGED_SERVICES=$(git diff --cached --name-only | grep '^services/' | cut -d'/' -f1-3 | sort -u || true)

if [ -z "$CHANGED_SERVICES" ]; then
  exit 0
fi

echo "Verifying service structure for staged changes..."
echo ""

for SERVICE_PATH in $CHANGED_SERVICES; do
  if [ ! -d "$SERVICE_PATH" ]; then
    continue
  fi

  SERVICE_NAME=$(basename "$SERVICE_PATH")
  DOMAIN=$(basename "$(dirname "$SERVICE_PATH")")

  # Check 1: project.json exists
  if [ ! -f "$SERVICE_PATH/project.json" ]; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing project.json"
    ERRORS=$((ERRORS + 1))
  fi

  # Check 2: src/service.stack.ts exists
  if [ ! -f "$SERVICE_PATH/src/service.stack.ts" ]; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing src/service.stack.ts"
    ERRORS=$((ERRORS + 1))
  fi

  # Check 3: test/ directory exists
  if [ ! -d "$SERVICE_PATH/test" ]; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing test/ directory"
    ERRORS=$((ERRORS + 1))
  fi

  # Check 4: No imports from services/
  if grep -rq "from.*['\"].*services/" "$SERVICE_PATH/src/" 2>/dev/null; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Import boundary violation: imports from services/"
    grep -rn "from.*['\"].*services/" "$SERVICE_PATH/src/" | head -3
    ERRORS=$((ERRORS + 1))
  fi

  # Check 5: Service name convention
  if ! echo "$SERVICE_NAME" | grep -qE -- '-(ctrl|bff|hub|adpt|web)$'; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Name must end with -ctrl, -bff, -hub, -adpt, or -web"
    ERRORS=$((ERRORS + 1))
  fi

  # Check 6: CLAUDE.md service card (warning only)
  if [ ! -f "$SERVICE_PATH/CLAUDE.md" ]; then
    echo -e "${YELLOW}WARN${NC} [$SERVICE_NAME] Missing CLAUDE.md service card (run audit-service)"
    WARNINGS=$((WARNINGS + 1))
  fi
done

# Check 7: nx affected blast radius (non-blocking)
AFFECTED=$(pnpm nx affected -t build --select=projects 2>/dev/null | tr ',' '\n' | wc -l | tr -d ' ' || echo "0")
if [ "$AFFECTED" -gt 5 ]; then
  echo ""
  echo -e "${YELLOW}WARNING: $AFFECTED projects affected by these changes${NC}"
  echo "  Run 'pnpm nx affected --select=projects' for the full list"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""
if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}FAILED: $ERRORS error(s), $WARNINGS warning(s)${NC}"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}PASSED with $WARNINGS warning(s)${NC}"
else
  echo -e "${GREEN}All structural checks passed${NC}"
fi
