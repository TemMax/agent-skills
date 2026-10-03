# 013 — Codex reads its own skill entrypoints

Date: 2026-10-03
Status: accepted

## Context

Decision 001 shares one skill text between Claude Code and Codex. A GPT-6.1 Sol
Codex session on 2026-10-02/03 showed what that costs when the text is written
for Claude Code:

- It re-read the multi-model `SKILL.md` with `cat` 37 times in 40 turns and hit
  the 40M TPM limit 7 times.
- It announced its profile in nearly every message.
- The coordinator applied a subagent's patch and edited a source file itself.
- It ran the full two-gate super-plan cycle, with three seam-audit versions, for
  a one-file `ci.yml` change.
- It asked the user three times to restart 1Password before diagnosing that the
  executor sandbox cannot reach the signing agent socket.
- A wave re-run needed hand-written `rm` cleanup, which Codex policy blocked.

## Decision

Each plugin gets host-split entrypoints. Codex reads `skills-codex/` (orchestration:
multi-model, super-plan, ship; code-review: critical-review); Claude Code keeps
`skills/`. Runners, linter, profiles, dossiers and the protocol stay in
`skills/*/references`, and the Codex files point at them by relative path.

The Codex entrypoints add:

- Codex session rules: load the skill once, announce the profile once, treat
  patch application as authoring, diagnose environment blocks before asking the
  user.
- A single-task path: one gate, no seam audit; lint, worktree, executor and
  separate supervisor stay.
- Unsigned executor commits (`git -c commit.gpgsign=false`), with the
  coordinator integrating each task by `git merge --squash` outside the
  sandbox, so the user's git configuration signs it.
- A runner `--reset` for a stopped wave, in place of hand-written cleanup.

Supervisors stay standard (`claude-opus-5`).

## Consequences

Two texts per skill must be kept in step. `tests/lib/codex-skill-check.py` and
`tests/contracts/codex-skill-split.test.sh` enforce the shared canonical blocks.

Claude skills are unchanged apart from the version bump.

Out of scope: the live evals `tests/eval/profile-routing.sh`, `super-plan.sh`,
`ship.sh`, `critical-review.sh` and `wave.sh` still hand GPT models the Claude
`SKILL.md`. Only `ship-smoke.sh` and `skill-navigation.sh` moved to the Codex
entrypoint. The Codex text is therefore not yet measured by the full eval set.

See [001 — Shared plugin policy with thin host adapters](001-dual-host-plugin-architecture.md).
