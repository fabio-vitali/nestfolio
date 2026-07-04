#!/bin/bash
set -euo pipefail
npm test | tee /tmp/test.log | tail -5
