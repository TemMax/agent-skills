#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="$(contract_source plugins/code-review/skills/critical-review/SKILL.md)"
CODEX="$(contract_source plugins/code-review/skills-codex/critical-review/SKILL.md)"

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

check "GPT-6 calibration keeps a general no-supported-route claim for Luna and Astra" \
  "one_line '$SKILL' | grep -qF 'No GPT-6 Luna or Astra review route is supported'"

check "GPT-6 calibration names the one policy supervisor route as uncalibrated" \
  "one_line '$SKILL' | grep -qF 'multi-model'\''s standard \`gpt-6-sol\` supervisor of all-\`gpt-6-luna\` waves' && one_line '$SKILL' | grep -qF 'a policy decision, not a measured pass, and uncalibrated in production'"

check "GPT-6 calibration forbids claiming a supported GPT-6 Luna or Astra review route" \
  "one_line '$SKILL' | grep -qF 'Never claim a supported GPT-6 Luna or Astra review route'"

check "GPT-6 calibration marks the Sol route measured-supported with the 2026-09-24 counts" \
  "one_line '$SKILL' | grep -qF 'The GPT-6 Sol review route is now **measured-supported**' && one_line '$SKILL' | grep -qF '10/10 combined clean, 10/10 combined planted' && one_line '$SKILL' | grep -qF 'PR support was 3/4, with one withheld-case miss'"

check "GPT-6 calibration runs a plan-recorded gpt-6-sol review as a measured route" \
  "one_line '$SKILL' | grep -qF 'When a ship plan records \`review.model: gpt-6-sol\`' && one_line '$SKILL' | grep -qF 'the review runs as a measured route' && one_line '$SKILL' | grep -qF '2026-09-24 strict-gate counts (10/10 clean, 10/10 planted)' && one_line '$SKILL' | grep -qF 'PR-support caveat (3/4, one withheld-case miss)'"

check "fix wave routing follows the plan format ci/e2e keys" \
  "one_line '$SKILL' | grep -qF 'A fix wave follows the plan format (\`ci\`, \`e2e\`)'"

check "a premium model is used only on the user's word, recorded in approvals.premium with its source" \
  "one_line '$SKILL' | grep -qF 'A premium model (Fable 5.1 / GPT-6 Astra) is used only when the user said so: in this session, or through a standing authorization written in the user'\''s or the repository'\''s instruction files (\`AGENTS.md\`, \`CLAUDE.md\`), which counts as the user'\''s choice and is recorded in \`approvals.premium\` with its source'"

check "premium use is never inferred from the request to fix" \
  "one_line '$SKILL' | grep -qF 'The request to fix findings is not a premium authorization, and premium use is never inferred from it'"

check "premium models are never the subject of a question" \
  "one_line '$SKILL' | grep -qF 'Premium models are never the subject of a question'"

check "a premium authorization covers later fix and recovery waves of the same pull request or task" \
  "one_line '$SKILL' | grep -qF 'An authorization given for a pull request or task covers its later fix and recovery waves while the models and roles stay the same'"

check "without a premium authorization the standard route or a direct fix is used and the report says so" \
  "one_line '$SKILL' | grep -qF 'Without an authorization use the standard route; when no standard delegated route fits, fix directly with the checks of a direct fix. The report notes in one line where a premium route would have applied'"

check "the Codex twin states the same standing premium authorization" \
  "one_line '$CODEX' | grep -qF 'A premium model (\`gpt-6-astra\`) is used only when the user said so: in this session, or through a standing authorization written in the user'\''s or the repository'\''s instruction files (\`AGENTS.md\`, \`CLAUDE.md\`), which counts as the user'\''s choice and is recorded in \`approvals.premium\` with its source'"

check "the coordinator chooses the fix route itself and never asks to approve a route or a model" \
  "one_line '$SKILL' | grep -qF 'Choose the fix route yourself.** Never ask the user to approve a route or a model'"

check "a direct fix is allowed when every stated condition holds" \
  "one_line '$SKILL' | grep -qF 'the coordinator makes the change itself when all of these hold: it can state the exact change before making it; the change stays inside the task already agreed with the user and inside one module or subsystem; no new public interface, data format or product behavior has to be decided; checks that cover the change exist or are added with it and can be run here'"

check "anything else goes to a supervised wave with local publication on the standard route" \
  "one_line '$SKILL' | grep -qF 'Anything else goes to a supervised wave: multi-model with \`publication: local\` on the standard route'"

check "a direct behavior change gets one independent check, and the report says when none ran" \
  "one_line '$SKILL' | grep -qF 'also gets one independent check of the diff from a fresh agent on the standard review route when the host can spawn one. The report says plainly when no independent check ran'"

check "one logical fix per commit" \
  "one_line '$SKILL' | grep -qF 'one logical fix per commit, staging only paths the fix touched'"

check "the user's own pull request is published without the gate" \
  "one_line '$SKILL' | grep -qF 'Publish the user'\''s own work without a question.** After verification is green, push the fix commits to the feature branch of the user'\''s own pull request — its author is the login \`gh api user --jq .login\` returns — and report what was pushed'"

check "the gate covers only others' threads and a push that is not the user's own" \
  "one_line '$SKILL' | grep -qF 'replies and resolves in threads started by someone else (the root comment'\''s author is another login), and a push to a branch or pull request that is not the user'\''s own' && one_line '$SKILL' | grep -qF 'a package without such items is published without the gate'"

check "a merge always needs the user's word" \
  "one_line '$SKILL' | grep -qF 'A merge is never part of this protocol; it needs the user'\''s word'"

check "re-running an approved plan or route after an environment fix needs no new approval" \
  "one_line '$SKILL' | grep -qF 'Re-running the same approved plan or route after the machine or the plan'\''s environment was fixed needs no new approval'"

check "the entrypoint leaves the fix route to the coordinator and follows a direct instruction as given" \
  "one_line '$SKILL' | grep -qF 'The fix route is then the coordinator'\''s own decision under FIXES.md; never ask the user to approve it' && one_line '$SKILL' | grep -qF 'If the user tells the coordinator to fix directly, or not to use agents, follow that instruction as given'"

check "the Codex twin publishes the user's own pull request without the gate and follows a direct instruction" \
  "one_line '$CODEX' | grep -qF 'a package without such items is published without the gate' && one_line '$CODEX' | grep -qF 'The user'\''s direct instruction wins' && one_line '$CODEX' | grep -qF 'If the user tells the coordinator to fix directly, or not to use agents, follow that instruction as given'"

check "the entrypoint no longer blocks a fix on a missing capability" \
  "! grep -rnE 'Missing capability blocks the route|stop at that capability boundary' plugins/code-review"

summary
