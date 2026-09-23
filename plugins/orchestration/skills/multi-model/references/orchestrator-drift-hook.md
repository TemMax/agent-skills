# Orchestrator drift hook — how it works and what it costs

Read from multi-model SKILL.md when working on, debugging or reasoning about
the drift hook; the orchestrator's own duty is stated in SKILL.md.

## Contents

- Orchestrator Drift
  - When the hook runs, and what it costs

## Orchestrator Drift

Supervised waves guard the executors. This layer guards the orchestrator
session itself — the loop that reads verdicts, decides rungs, and reports back
to the user is not exempt from the same drift it polices in others.

It ships as a plugin hook on `Stop`, fires once per turn, and **advises — it
never blocks.** The advice arrives as `additionalContext`, and the orchestrator
is expected to act on it or say why not; nothing in the mechanism can halt the
turn or force a rework.

It needs the wave plan artifact to compare the orchestrator's actual behavior
against. With no plan file present, it stays silent — there is nothing to
check drift against, so it produces no advice rather than guessing at one.

Installing the plugin turns it on; removing the plugin turns it off. The user
edits no settings file to enable or disable it — the hook's presence is the
only switch.

### When the hook runs, and what it costs

The plan is a permanent artifact — it is the record of what each executor was
contracted to do, and the thing a supervisor compares against. So the plan is
never deleted to quiet the hook. Its lifecycle lives in a field instead:

```yaml
status: active   # active | done — only 'active' runs the hook
```

It watches **any** plan under `docs/superpowers/plans/`, not only a wave plan: an
orchestrator drifts from an implementation plan the same way — a task quietly
dropped, a step reported done that nothing ran.

Five gates decide whether the model is called at all, cheapest first: a nested
run of the hook inside its own `claude -p` call; a turn that our own advice
caused; **no plan says `status: active`**; no branch named by the plan still
the plan **declares** with a `branch:` key still exists; and a turn where the
orchestrator claimed nothing.

The branch gate reads declared branches only. Matching `wave/...` anywhere in the
text silenced any generalised plan that merely mentioned an old branch in prose —
a wave-specific gate left in the path of a trigger that is no longer
wave-specific.

Two of those come from running it rather than reading it. **The gate reads the
hook payload, never the transcript file** — the Stop hook fires before the
harness finishes writing the turn, measured at 67 seconds ahead in one live
session, so a file-based gate would silently never fire. The payload carries
`last_assistant_message` directly. And advice injected at Stop makes the model
continue, which fires Stop again: without the `stop_hook_active` gate one piece
of advice cost three deliveries and about a minute.

The status gate **fails closed**, and reads only the plan's header — it stops at
the first code fence and requires the key at column 0. Only an explicit
`status: active` runs the hook; a missing or unrecognised status keeps it off. A
page that documents the feature by showing the key inside a fenced yaml block
would otherwise switch the hook on: the activate-by-omission failure in a
different hat. Closing on `status: done`
instead would have reproduced the original defect for every plan whose author
never wrote a status — the file outlives the work and the hook fires forever. A
hook must not be able to switch itself on by omission.

Delivered advice is appended to `$TMPDIR/claude-drift-log/<session>.jsonl` with
the plan and what the orchestrator had just said. The hook never reads it back;
it exists so the question that matters about any advisory layer — does anyone
act on it — can be answered from evidence instead of impression.

The fourth gate is the one that matters for cost. Branches disappear when their
work is merged, so it reads the state of the work rather than anyone's
discipline: forget to flip `status` and the hook still goes quiet once the wave
lands. Forgetting degrades to silence instead of to a permanent per-turn tax.

The fifth gate is a keyword heuristic and is labelled as one in the script. It
filters cost, not correctness — a missed check in an advisory mechanism is a
missed suggestion. That trade would not be acceptable if the hook could block.

**The latency cannot be delegated away.** Setting `async: true` on the hook was
measured on 2026-08-11: the hook does not appear in the session log at all and
its `additionalContext` is never delivered. Advice and asynchrony are mutually
exclusive here, so the ~8s model call is paid inside the turn or not at all.
Gate it; do not shorten it — the cost *is* the model call, and cutting it short
only buys worse advice at the same price.

**The check does not repeat itself.** Each invocation is stateless, so during a
live wave it would hand the orchestrator the identical note on every
claim-shaped turn. A per-session memo holds a digest of the last advice actually
delivered and suppresses an exact repeat; different advice still gets through.
The prompt cannot enforce this — a stateless call has no way to know what it
said last time.

`plugins/orchestration/hooks/drift-check.test.sh` covers every gate offline via
`CLAUDE_DRIFT_CHECK_DRYRUN=1`, which prints the decision instead of calling the
model, and the post-call logic via `CLAUDE_DRIFT_CHECK_FAKE_ANSWER`, which
substitutes the reply. `LIVE=1` adds the real end-to-end path.
