#!/usr/bin/env bash
# Shellcheck wrapper for deploy-mfe.sh. Mirrors test-deploy-shell-shellcheck.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/deploy-mfe.sh"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck not installed; skipping." >&2
  exit 0
fi

shellcheck -x "$TARGET"
