#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
node --test tests/lib/codex-authoring-route.test.mjs
