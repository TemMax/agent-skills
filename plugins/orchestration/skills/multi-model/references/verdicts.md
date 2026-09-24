# Verdicts — what the verifier and the supervisor produce, and how to read them

Read from multi-model SKILL.md before judging or acting on a verifier result
or a supervisor verdict.

## Contents

- Mechanical verification before the judge
- The supervisor's verdict
- The blocking threshold sits above the suspicion threshold

## Mechanical verification before the judge

The shipped runner inserts a fact-collecting stage between the executor and
the judge. A cheap verifier agent (default `claude-sonnet-5`/`low`, overridable via
`args.verifier`) checks out the branch and records facts: does the branch
carry commits at all, which paths changed, what each `must_run` command
returns when actually run, and whether the report pastes output where the
contract says `evidence: required`. The verifier runs each `must_run` as one
`bash -c` command line and records that line's exit status, so negated
(`! grep …`) and piped commands are judged as written. The runner — not a
model — then applies the deterministic half of the contract: a branch with no commits, a path
outside `files_allowed`, or a red `must_run` bounces straight back to the
executor as a rework, and no judge is paid for discovering it. Missing
pasted evidence bounces the same way only when the command was red; a
missing paste for a command the verifier reproduced green goes to the judge
instead, because report-only rework loops on that rule re-ran unchanged code
for no benefit — measured in a 2026-09-22 ship run, and twice in stage A.
Transcript mining across five real sessions found "work
done but never committed" to be the single most common rejection (8+
occurrences), each costing a full Opus verdict to detect.

Three properties are load-bearing:

- **Fail-open.** A dead verifier skips the stage; the model judge then runs
  the full pipeline itself, exactly as before. Mechanical verification can
  only save a judge call, never remove supervision.
- **Once per rule.** The same mechanical rule failing twice routes to the
  model judge with the facts attached — only a judge can decide
  `satisfiable`, and a repeat is where that question arises.
- **Facts, not judgment.** The verifier never decides `ok`,
  `pasteReproduced` or `satisfiable`; those stay with the judge, which
  receives the verifier's facts and may rely on its exit codes and outputs
  while re-running anything it doubts.

**Long commands, everywhere in the wave, are classified by kind — never by
predicted duration.** Build-system invocations (gradle, cargo, npm, pnpm,
yarn, make, mvn and the like) start in the background with output to a log
file and are polled; everything else runs in the foreground. A silent
foreground wait on a cold build looks like a stall and gets the agent
killed — one real session lost ~4.8 hours of supervision to exactly this,
then abandoned supervision entirely.

## The supervisor's verdict

**The supervisor trusts artifacts only.** It checks out `wave/<task-id>` into
its own worktree, runs the diff itself, executes each `must_run` command itself,
and greps for the forbidden moves itself. The report is a set of claims to
check, never a source of facts.

**A paste that does not reproduce is a fact, not an accusation.** The executor
pastes command output; the supervisor re-runs the command and compares. When they
differ it records `pasteReproduced: false` with both outputs — and stops there.
Whether the mismatch was fabrication, output captured before the last commit, a
differently-prepared tree, or a date-dependent test is not decidable from what a
supervisor can see, and four attempts to make a model decide it correctly all
failed in the same direction: the heaviest accusation, spent on honest work.

Verification asks whether something reproduces, not whether its author was
truthful — the answer reproducible builds arrived at. A single non-reproducing
paste rides along with the rework so the executor sees it. **Repetition is what
escalates**, and repetition is counted by the ladder, not judged by the
supervisor.

Verdict shape:

```json
{"ok": false,
 "violations": [{"rule": "must_run:pytest tests/http -q",
                 "class": "must_run",
                 "pasteReproduced": false,
                 "evidence": "report pasted a green run; supervisor got 2 failed",
                 "quote": "tests/http/test_retry.py::test_backoff FAILED"}],
 "remarks": ["src/http/backoff.py:41 duplicates the helper in src/net/retry.py"]}
```

`violations` decide `ok`; `remarks` never do. Classes: `files`, `must_run`,
`forbidden-move`, `report`. A violation without evidence the
supervisor produced itself is dropped, not softened — otherwise the supervisor
fabricates as readily as the executor it judges.

When a `must_run` command fails, run it a second time before recording anything.
If the retry passes, record a remark naming the command unstable and do not
block. Spending the supervisor's credibility on flaky tests buys nothing.

## The blocking threshold sits above the suspicion threshold

Rework is triggered only by contract violations. Anything the supervisor merely
finds doubtful goes to `remarks` and reaches the user through the wave report.
**Blocking correct work is a worse failure than missing a nitpick** — a
supervisor that stops legitimate work does not just waste a wave, it
manufactures confidence in the waves it lets through.
