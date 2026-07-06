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

# Runtime enforcement gate (runtime-make-it-fire) — content-ring commit-trigger checks over the STAGED set,
# via the ring-1 watch engine (diff-scoped: findings are attributed to staged files). Runs on EVERY commit,
# so it MUST precede the services-only early-exit below. Fail-closed: non-zero exit blocks the commit.
if ! node runtime/adapters/git/pre-commit-gate.mjs; then
  exit 1
fi

CHANGED_SERVICES=$(git diff --cached --name-only | grep '^services/' | cut -d'/' -f1-3 | sort -u || true)

if [ -z "$CHANGED_SERVICES" ]; then
  exit 0
fi

echo "Verifying service structure for staged changes..."
echo ""

# Hard-fail structural invariants #1-#5 (extracted, shared with the runtime service-structure check)
if ! RUNTIME_STAGED_PATHS="$(git diff --cached --name-only)" bash scripts/check-service-structure.sh; then
  ERRORS=$((ERRORS + 1))
fi

for SERVICE_PATH in $CHANGED_SERVICES; do
  if [ ! -d "$SERVICE_PATH" ]; then
    continue
  fi

  SERVICE_NAME=$(basename "$SERVICE_PATH")
  DOMAIN=$(basename "$(dirname "$SERVICE_PATH")")

  # Check 6: CLAUDE.md service card (warning only)
  if [ ! -f "$SERVICE_PATH/CLAUDE.md" ]; then
    echo -e "${YELLOW}WARN${NC} [$SERVICE_NAME] Missing CLAUDE.md service card (run audit-service)"
    WARNINGS=$((WARNINGS + 1))
  fi
done

# Check 7: nx affected blast radius (non-blocking)
AFFECTED=$(pnpm nx affected -t build --select=projects 2>/dev/null | tr ',' '\n' | wc -l)
AFFECTED=$(echo "$AFFECTED" | tr -d '[:space:]')
AFFECTED=${AFFECTED:-0}
if [ "$AFFECTED" -gt 5 ]; then
  echo ""
  echo -e "${YELLOW}WARNING: $AFFECTED projects affected by these changes${NC}"
  echo "  Run 'pnpm nx affected --select=projects' for the full list"
  WARNINGS=$((WARNINGS + 1))
fi

# Check 8: typed-subject convention gate (blocking, daemon-free pure-node scan)
if ! node tools/check-typed-subjects.mjs > /tmp/typed-subject-check.out 2>&1; then
  cat /tmp/typed-subject-check.out
  ERRORS=$((ERRORS + 1))
fi

# Check 9: typed-fixture regression gate (blocking, daemon-free pure-node scan)
if ! node tools/check-typed-fixtures.mjs > /tmp/typed-fixture-check.out 2>&1; then
  cat /tmp/typed-fixture-check.out
  ERRORS=$((ERRORS + 1))
fi

# Check 10: service-card drift gate (blocking, daemon-free pure-node scan)
if ! node tools/check-service-card-drift.mjs > /tmp/card-drift-check.out 2>&1; then
  cat /tmp/card-drift-check.out
  ERRORS=$((ERRORS + 1))
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
