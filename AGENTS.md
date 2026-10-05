# Working on agent-skills

## Installed plugins

Keep the user's installed plugins on their Git marketplace sources. Do not
update installed versions from a local checkout, switch marketplace sources,
or edit installed caches. Install updates only from Git after merge. Candidate
checks use disposable host loading without modifying the installed plugins.

## Live validation is required

Changes to plugin behavior (skill instructions, prompts, hooks, routing or
execution/recovery) require a live check of the affected scenarios through the
real host CLI and real models before they are called verified or release-ready.
For shared Claude/Codex changes, check both Claude Code and Codex. Offline
contracts, simulated answers and stub CLIs are complementary checks, not a
substitute for live behavior.

Use a fresh disposable fixture, freeze the expected outcomes before the run,
and verify which candidate files/version the host actually loaded. A narrow
semantic probe cannot stand in for a real execution/recovery flow; plugin
discovery changes also need a run with normal plugin loading enabled. Do not
silently test installed old files or archive HEAD while candidate edits remain
uncommitted.

Keep checks proportional: run affected cases first using the authorized model
routes, bounded calls/time and fresh result directories. Inspect failures before
retrying; retain failures, prompts, tool traces, artifact outcomes and measured
usage. Expand to repetitions or a larger matrix only when the evidence warrants
it. Existing model, access and premium authorization limits still apply.

Report offline validation and live validation separately. A transport or
environment failure is a blocked run, not a product pass. If a required live
check cannot run, state the exact missing check and blocker and leave the change
unverified; do not claim unchanged quality or token savings from stub results.

The fixtures and drivers are documented in [tests/README.md](tests/README.md).
The current cost-control package's required scenarios are in
[first-package-regressions.md](tests/eval/first-package-regressions.md).
