#!/usr/bin/env bash
set -euo pipefail
# check-service-structure.sh — hard-fail structural invariants (#1-#5) for staged services.
# GATE-FREE: never invokes the runtime gate (avoids recursion when run as a cmd: CheckEntry).
# Service list from RUNTIME_STAGED_PATHS (newline-separated staged∩scope) when set, else git diff --cached.
RED='\033[0;31m'; NC='\033[0m'
ERRORS=0

if [ -n "${RUNTIME_STAGED_PATHS:-}" ]; then
  CHANGED_SERVICES=$(printf '%s\n' "$RUNTIME_STAGED_PATHS" | grep '^services/' | cut -d'/' -f1-3 | sort -u || true)
else
  CHANGED_SERVICES=$(git diff --cached --name-only | grep '^services/' | cut -d'/' -f1-3 | sort -u || true)
fi
[ -z "$CHANGED_SERVICES" ] && exit 0

for SERVICE_PATH in $CHANGED_SERVICES; do
  [ -d "$SERVICE_PATH" ] || continue
  SERVICE_NAME=$(basename "$SERVICE_PATH")
  [ -f "$SERVICE_PATH/project.json" ]        || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing project.json"; ERRORS=$((ERRORS+1)); }
  [ -f "$SERVICE_PATH/src/service.stack.ts" ] || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing src/service.stack.ts"; ERRORS=$((ERRORS+1)); }
  [ -d "$SERVICE_PATH/test" ]                 || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing test/ directory"; ERRORS=$((ERRORS+1)); }
  if grep -rq "from.*['\"]services/" "$SERVICE_PATH/src/" 2>/dev/null; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Import boundary violation: imports from services/"; ERRORS=$((ERRORS+1))
  fi
  echo "$SERVICE_NAME" | grep -qE -- '-(ctrl|bff|hub|adpt|web)$' || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Name must end with -ctrl, -bff, -hub, -adpt, or -web"; ERRORS=$((ERRORS+1)); }
done
[ "$ERRORS" -gt 0 ] && exit 1 || exit 0
