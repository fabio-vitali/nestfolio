#!/usr/bin/env bash
# Self-test for scripts/assert-shell-html.mjs.
# Builds synthetic dist/index.html fixtures in a tmp dir and asserts the script's exit codes.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT="$SCRIPT_DIR/assert-shell-html.mjs"

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Canonical good shell HTML (CSP hash matches sha256-base64 of {"shimMode":true})
GOOD_HASH="NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U="
GOOD_ESMS='{"shimMode":true}'

write_good_shell() {
  local dir="$1"; mkdir -p "$dir"
  cat > "$dir/index.html" <<EOF
<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-$GOOD_HASH'; style-src 'self'">
<script type="esms-options">$GOOD_ESMS</script>
<script type="module" src="polyfills-ABC123.js"></script>
<script type="module-shim" src="main-DEF456.js"></script>
</head><body><app-root></app-root></body></html>
EOF
}

write_good_mfe() {
  local dir="$1"; mkdir -p "$dir"
  cat > "$dir/index.html" <<EOF
<!doctype html>
<html><head>
<script type="esms-options">$GOOD_ESMS</script>
<script type="module" src="polyfills-XYZ.js"></script>
<script type="module-shim" src="main-XYZ.js"></script>
</head><body></body></html>
EOF
}

expect_exit() {
  local label="$1" expected="$2" got="$3"
  if [[ "$got" -eq "$expected" ]]; then pass "$label (exit=$got)"; else fail "$label expected exit=$expected, got=$got"; fi
}

# Pass cases
D="$TMP/good-shell"; write_good_shell "$D"
node "$ASSERT" "$D" --kind=shell; expect_exit "good shell" 0 $?

D="$TMP/good-mfe"; write_good_mfe "$D"
node "$ASSERT" "$D" --kind=mfe; expect_exit "good mfe" 0 $?

# Rule 1: missing polyfills tag
D="$TMP/no-polyfills"; write_good_shell "$D"
sed -i.bak '/polyfills-/d' "$D/index.html" && rm "$D/index.html.bak"
node "$ASSERT" "$D" --kind=shell; expect_exit "rule 1 missing polyfills" 1 $?

# Rule 1: malformed polyfills tag (missing close before garbage)
D="$TMP/malformed-polyfills"; write_good_shell "$D"
sed -i.bak 's|<script type="module" src="polyfills-ABC123.js"></script>|<script type="module" src="polyfills-ABC123.js" >garbage</script>|' "$D/index.html" && rm "$D/index.html.bak"
node "$ASSERT" "$D" --kind=shell; expect_exit "rule 1 malformed polyfills" 1 $?

# Rule 2: missing main module-shim tag
D="$TMP/no-main-shim"; write_good_shell "$D"
sed -i.bak '/main-/d' "$D/index.html" && rm "$D/index.html.bak"
node "$ASSERT" "$D" --kind=shell; expect_exit "rule 2 missing main shim" 1 $?

# Rule 3: malformed esms-options JSON
D="$TMP/bad-esms-json"; write_good_shell "$D"
sed -i.bak 's|<script type="esms-options">{"shimMode":true}</script>|<script type="esms-options">{not json}</script>|' "$D/index.html" && rm "$D/index.html.bak"
node "$ASSERT" "$D" --kind=shell; expect_exit "rule 3 bad json" 1 $?

# Rule 4: wrong esms-options body
D="$TMP/wrong-esms-body"; write_good_shell "$D"
sed -i.bak 's|<script type="esms-options">{"shimMode":true}</script>|<script type="esms-options">{"shimMode":false}</script>|' "$D/index.html" && rm "$D/index.html.bak"
node "$ASSERT" "$D" --kind=shell; expect_exit "rule 4 wrong body" 1 $?

# Rule 5: CSP hash mismatch (shell only)
D="$TMP/csp-mismatch"; write_good_shell "$D"
sed -i.bak "s|sha256-$GOOD_HASH|sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=|" "$D/index.html" && rm "$D/index.html.bak"
node "$ASSERT" "$D" --kind=shell; expect_exit "rule 5 csp mismatch" 1 $?

# Rule 5 NOT enforced for mfe (mfe ignores CSP entirely)
D="$TMP/mfe-no-csp"; write_good_mfe "$D"
node "$ASSERT" "$D" --kind=mfe; expect_exit "mfe ignores rule 5" 0 $?

# Argument validation
node "$ASSERT" 2>/dev/null; expect_exit "missing args" 2 $?
node "$ASSERT" "$TMP/good-shell" --kind=invalid 2>/dev/null; expect_exit "bad kind" 2 $?

echo
echo "All assertion-script self-tests passed."
