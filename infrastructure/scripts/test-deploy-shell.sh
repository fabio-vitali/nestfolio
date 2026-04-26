#!/usr/bin/env bash
# test-deploy-shell.sh — Lint deploy-shell.sh with shellcheck.
# Skips with a notice if shellcheck is not installed (matches the pattern
# used by scripts/test-assert-shell-html.sh).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck not installed — skipping. Install with: brew install shellcheck"
  exit 0
fi

shellcheck "$SCRIPT_DIR/deploy-shell.sh"
echo "deploy-shell.sh: shellcheck OK"
