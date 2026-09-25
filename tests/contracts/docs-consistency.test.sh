#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

PROTOCOL=plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md
AMEND=plugins/orchestration/skills/multi-model/references/contract-amendment.md
VD=plugins/orchestration/skills/multi-model/references/verdicts.md
CWA=plugins/orchestration/skills/multi-model/references/claude-wave-adapter.md
README=README.md
CHANGELOG=CHANGELOG.md
ADR009=docs/decisions/009-environment-blocked-and-worktree-env.md

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

section "codex-wave-protocol.md: re-running after a stop"
check "a post-init stop's cleanup is what the orchestrator runs before a fresh --out" \
  "one_line '$PROTOCOL' | grep -qF 'fresh \`--out\`'"
check "the runner itself preserves state files/worktrees/branches on stop" \
  "one_line '$PROTOCOL' | grep -qF 'preserves every state file, worktree and branch'"
check "pre-init stops (depends-on-unmet, preflight) are distinguished from post-init cleanup" \
  "one_line '$PROTOCOL' | grep -qF 'pre-init stops'"

section "codex-wave-protocol.md: where the blocked line is read"
check "tasks[].environment (state helper) is named" \
  "grep -qF 'tasks[].environment' $PROTOCOL"
check "stopped[].environment (runner child errors) is named" \
  "grep -qF 'stopped[].environment' $PROTOCOL"
check "pre-init stops print their summary JSON to stdout only, no summary.json file" \
  "one_line '$PROTOCOL' | grep -qF 'goes to stdout only'"

section "claude-wave-adapter.md: re-run after environment-blocked is a fresh Workflow invocation"
check "a fresh Workflow invocation is named" \
  "grep -qF 'fresh \`Workflow(' $CWA"
check "resumeFromRunId is named as the wrong tool for this re-run" \
  "grep -q 'never \`resumeFromRunId\`' $CWA"
check "resumeFromRunId would replay the cached blocked report" \
  "one_line '$CWA' | grep -qF 'replay the cached blocked report'"

section "\"never charged as an attempt\" reworded to \"ends the task\""
for f in "$CHANGELOG" "$ADR009" "$PROTOCOL" "$VD"; do
  check "$f: 'no retry, escalation or amendment' appears" \
    "one_line '$f' | grep -qF 'no retry, escalation or amendment'"
done
check "only the typed child-error path is truly uncharged (CHANGELOG)" \
  "one_line '$CHANGELOG' | grep -qF 'is never charged as an attempt at all'"
check "only the typed child-error path is truly uncharged (ADR 009)" \
  "one_line '$ADR009' | grep -qF 'is never charged as an attempt at all'"

section "verdicts.md: the environment class's mechanical source"
check "the verifier's-checkout-could-not-be-trusted claim is gone" \
  "! one_line '$VD' | grep -qF \"verifier's checkout could not be trusted\""
check "the executor's first-line marker is named as a source" \
  "one_line '$VD' | grep -qF 'environment-blocked:\` marker as its first line'"
check "a must_run signature match is named as a source" \
  "one_line '$VD' | grep -qF 'matched a known'"
check "a supervisor may assign the class itself" \
  "one_line '$VD' | grep -qF 'a supervisor may also assign'"

section "dead references to \"the friction plan\" are gone"
for f in "$PROTOCOL" "$VD" "$AMEND"; do
  check "$f: no mention of 'friction plan'" \
    "! grep -qi 'friction plan' $f"
done
check "codex-wave-protocol.md points to the Plan Format section instead" \
  "one_line '$PROTOCOL' | grep -qF 'Plan Format'"
check "verdicts.md points to ADR 009 instead" \
  "one_line '$VD' | grep -qF 'ADR 009'"
check "contract-amendment.md points to ADR 009 and the Plan Format section" \
  "one_line '$AMEND' | grep -qF 'ADR 009'"
check "contract-amendment.md's inherits bullet points to the Plan Format section" \
  "one_line '$AMEND' | grep -qF 'Plan Format'"

section "contract-amendment.md: an inherited e2e naming a parent task"
check "the recovery plan marks it not-applicable automatically" \
  "one_line '$AMEND' | grep -qF 'not-applicable: inherited e2e task'"

section "codex-wave-protocol.md: worktree-env.mjs citations replaced by function names"
check "no more worktree-env.mjs:<line> citations" \
  "! grep -q 'worktree-env.mjs:[0-9]' $PROTOCOL"
check "excludeFromGit is named" \
  "grep -qF 'excludeFromGit' $PROTOCOL"
check "gitCommonDir is named" \
  "grep -qF 'gitCommonDir' $PROTOCOL"
check "resolveWorktreeEnv is named" \
  "grep -qF 'resolveWorktreeEnv' $PROTOCOL"
check "applyLinks is named" \
  "grep -qF 'applyLinks' $PROTOCOL"
check "checkDependsOn is named" \
  "grep -qF 'checkDependsOn' $PROTOCOL"
check "the Contents list carries the Toolchain caches section" \
  "one_line '$PROTOCOL' | grep -qF 'Toolchain caches, \`.git\` and linked files'"

section "README.md: current versions"
check "orchestration 4.2.0, code-review 1.11.0" \
  "grep -qF 'orchestration 4.2.0, code-review 1.11.0' $README"

summary
