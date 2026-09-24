#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="plugins/code-review/skills/critical-review/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "review method requires waiting for parallel reviews before presenting findings" \
  "one_line '$SKILL' | grep -qF 'wait until every one has finished, then present all findings once, in one table per scope, before asking to fix anything'"

check "review rule cites the 2026-09-22 double fix-approval cause" \
  "one_line '$SKILL' | grep -qF 'in a 2026-09-22 run, findings were shown while a second review was still running, which forced a second fix approval and a second fix plan'"

check "review rules allow reviewing in-scope files but never reproducing a secret value" \
  "one_line '$SKILL' | grep -qF 'never reproduce a secret value found there: cite \`file:line\` and the key name only'"

check "credential rule names example config paths outside review scope" \
  "one_line '$SKILL' | grep -qF '~/.codex' && one_line '$SKILL' | grep -qF '~/.claude' && one_line '$SKILL' | grep -qF 'key name only'"

check "credential rule forbids opening credential stores or config files outside review scope" \
  "one_line '$SKILL' | grep -qF 'Never open credential stores or configuration files outside the review'\''s scope'"

check "credential rule forbids printing, copying or transmitting a credential or token value from any file" \
  "one_line '$SKILL' | grep -qF 'never print, copy or transmit a credential or token value from any file, in or out of scope'"

check "credential rule cites the measured Authorization-value cause" \
  "one_line '$SKILL' | grep -qF 'a reviewer printed an Authorization value from a local config in the same run'"

check "GPT-6 calibration keeps a general no-supported-route claim" \
  "one_line '$SKILL' | grep -qF 'No GPT-6 review route is supported yet'"

check "GPT-6 calibration names the one policy supervisor route as uncalibrated" \
  "one_line '$SKILL' | grep -qF 'multi-model'\''s standard \`gpt-6-sol\` supervisor of all-\`gpt-6-luna\` waves' && one_line '$SKILL' | grep -qF 'a policy decision, not a measured pass, and uncalibrated in production'"

check "GPT-6 calibration forbids claiming a supported GPT-6 review route" \
  "one_line '$SKILL' | grep -qF 'Never claim a supported GPT-6 review route'"

check "fix wave routing follows the plan format ci/e2e keys" \
  "one_line '$SKILL' | grep -qF 'A fix wave follows the plan format (\`ci\`, \`e2e\`)'"

check "fix wave premium roles require approvals.premium at the fix gate" \
  "one_line '$SKILL' | grep -qF 'a premium model (Fable 5.1 / GPT-6 Astra) in any role of that wave needs \`approvals.premium\` recorded from the user'\''s choice at this fix gate'"

check "premium approval is never inferred from the approval to fix" \
  "one_line '$SKILL' | grep -qF 'the approval to fix is not an approval to spend premium, and premium use is never inferred from it'"

summary
