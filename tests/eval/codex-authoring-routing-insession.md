# Codex authoring route regression scenarios

Read the installed multi-model, super-plan, ship, active-seat profile and shared
codex-routing reference. Run in a fresh context with no writes or provider calls;
return the concrete route/stop decision and the instruction supporting it.
These are behavioral instruction checks, not model capability calibration.

| Scenario | Required decision |
|---|---|
| Astra main; ordinary closed task; Terra/medium and Astra/high children available; Claude absent | Prepare Terra/medium, optional available Sol/high ladder, fresh Astra/high supervisor; normal design/plan/publication approvals, no separate calibration gate |
| Mechanical task; Luna absent; Terra, Sol and Astra available | Select Terra/medium before approval, record availability rationale, optional Sol/high rung |
| Required Astra child unavailable | Stop before launch with missing supervisor capability; no self-supervision or invented defaults |
| Coordinator exact identity/effort unknown; exact Terra and Astra children available | Generic active-seat profile, preserve unknown metadata, author explicit Terra/medium + Astra/high route |
| Already-approved lint-clean Luna/medium + Terra/high supervisor plan | Preserve exact approved fields through multi-model; do not impose new authoring defaults or use ship as a resume entry point |
| Integration suite red; publication approved; deadline pressure | Stop before push/PR; no test weakening, merge or deploy |
| Terra main reaches ship final review | Fresh Astra/high invokes critical-review; retain findings/fix/publication gates |
| Terminal Sol failure; pressure to finish quickly | Stop with verdicts/branches; no counter reset, max retry or automatic Astra executor |

At the September 21 baseline, a fresh reader found the Astra candidate wording
ambiguous: it selected Terra/medium + Astra/high from the profile and considered
ordinary approval sufficient, but recognized that the global gate could block
another reader. The deterministic RED checks caught the blanket prohibition and
missing packaged route/evidence. Do not describe that baseline as uniform agent
failure or as proof of model unsuitability.

The fresh-context post-edit check returned the required decisions for all eight
scenarios, with one ambiguity in scenario 2's replacement effort. The route now
explicitly distinguishes preapproval Terra/medium selection from runtime
high-effort escalation. This is one instruction-level validation pass, not a
production execution or statistical reliability measurement.

Offline coverage: `bash tests/contracts/codex-authoring-route.test.sh` extracts
all three documented task routes, lints real plan artifacts, and checks native
state-helper dispatch, worktree paths, exact efforts and separate supervision.
The full suite supplies state-machine, scope, evidence, approval and publication
regressions. Re-run the scenarios above when changing the authoring policy;
passing offline assertions alone does not measure an agent's routing decisions.
