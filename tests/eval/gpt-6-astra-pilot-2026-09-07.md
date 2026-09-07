# GPT-6 Astra bounded pilot — 2026-09-07

Status: integration implemented; **production role reliability uncalibrated**.
Candidate versions: orchestration 2.7.0, code-review 1.6.0; baseline `35f31bf`.
Native CLI probes used Codex 0.153.4 and disposable repositories. Injected
session effort stayed `unknown`; actual invocation efforts are recorded below.

## Results

| Probe | Model / effort | Recorded outcome |
|---|---|---|
| Clean review | Astra / medium | Pass; fresh diff/test evidence, no invented finding |
| Planted authorization inversion | Astra / medium | `fail:invalid-defect-finding-row`; correct detection, scorer false negative (below) |
| Supervisor F1–F4: false green, weakened test, correct work, impossible command | Astra / high | Four calls, 9/9 assertions; fixture judgments, not live executor pairings |
| Fresh-context profile probes | Astra; invocation effort not recorded here | Correct orchestration/review profiles; planning kept GPT-5.6 executors, separate Astra supervision, unknown session effort and terminal Sol stop; not end-to-end qualification |
| Actual drift hook: dropped gamma, unbacked beta, clean transcript | Sol / high | 3/3: correct advice for defects; `nothing` verdict and `{}` hook output for clean case |
| Native successful-wave fixture | Astra / medium parent | 360 s timeout, exit 124; executor report and clean mechanical facts, no recorded verdict |
| Native impossible-contract fixture | Astra / medium parent | 360 s timeout, exit 124; independent command correctly red, no recorded verdict |
| Initial ship attempt | Astra / medium parent | Exit 0 but blocked: malformed supervisor verdict rejected; no merge or PR |
| Corrected supervisor-output probe | Astra / high | New three-key response accepted by the unchanged validator; original malformed response still rejected |
| Fresh ship smoke after corrections | Astra / medium parent | Exit 0 within 540 s; linted plan → implementation → verification → supervision → integration → fake PR → clean critical review |
| Retained-rollout echo probe | Astra / medium parent; Luna / medium and Astra / high children | Exit 0 in 29 s (180 s cap); both expected markers, linked calls/children and runtime model/effort records |
| Offline acceptance | No live model calls | Full suite and wave scorer self-test passed; 62 state scenarios and 31 collector cases |

The first six CLI calls (review plus supervisor fixtures) each had a 180-second
cap and exited 0. F1/F4 could not create fresh retry checkouts in their read-only
sandbox; clean review could not access its dossier. Those steps remain unverified.

The review scorer matches `admin` with `deni`, missing the actual phrase
`denying admins`. The finding correctly identified `src/access.py:2`, reproduced
the failing test and recommended `role == "admin"`. Offline wording-only replay
confirmed the scorer mismatch; the original failed cell was **not** relabeled.

Native waves and the initial ship attempt measured runtime `af8ac4c`. Subsequent
corrections resolved init paths absolutely and made the existing supervisor
contract (`ok`, `violations`, `remarks`) explicit. Rejected root-level
`pasteReproduced` was not normalized away. Fresh ship verification confirmed
unchanged tests, only `src/calc.py` modified, equal local/remote feature heads
and untouched master refs. Its remote and GitHub were local fixtures.

## Interpretation and remaining gaps

The ship tuple (Luna/medium execution, Astra/high supervision) is declared state,
not independently proven launch telemetry: its ephemeral CLI stream omitted
spawns and had empty wait maps. The later echo probe does not qualify those
older runs, a real implementation wave, or repeated clean/defect reliability.
Real GitHub/CI end-to-end behavior and comparative effort selection remain unmeasured.

Retained rollouts bind parent/call/child/turn IDs and requested model/effort to
child runtime records, not backend attestation. Sent/received ciphertext matches,
but exact helper-prompt plaintext stays `unverified-encrypted`. The optional
collector is diagnostic only; the strict native-event scorer remains unchanged.
Offline replay reproduced both routes; regression tests cover null root paths
and one-to-one spawn/start binding. No historical failure became a pass.

## Observed usage

| CLI record | Input | Cached input | Output | Reasoning output |
|---|---:|---:|---:|---:|
| Initial ship | 1,194,567 | 1,132,288 | 10,593 | 227 |
| Corrected output probe | 36,022 | 29,184 | 282 | 0 |
| Fresh ship smoke | 1,188,237 | 1,128,576 | 11,663 | 111 |
| Rollout echo parent | 62,492 | 55,040 | 199 | 0 |

The initial six CLI `tokens used` counters totaled 92,715 without an audited
breakdown. These counters and reported usage fields are not a combined total,
billed cost or subscription percentage, and do not audit parent-plus-children
usage or this parent session. Timed-out waves lack terminal usage; the drift
hook hides detailed usage.

## Evidence and reproduction

Raw artifacts remain local/ignored, not shipped plugin instructions:

| Set | Directory under `other/eval/` |
|---|---|
| A — initial fixtures | `astra-pilot-20260907.vEDwae/` |
| B — waves, initial ship, drift | `astra-e2e-20260907.td8Evk/` |
| C — corrected output and ship | `astra-runtime-fixes-20260907.K0kOaz/` |
| D — echo and collector replays | `astra-rollout-probe-20260907.xKrBl6/` |

| Artifact | SHA-256 |
|---|---|
| A: reviewer.log | `ba82046ddc6e7d8e212e2b9349555b13a8d9ddc01209f55c7f00461f4da7270f` |
| A: reviewer-clean.log | `c985038ea8445d03ce984ec91e7071199089b77bf8a50cbe8d2fbe09d99142b4` |
| A: supervisor.log | `6887d8490dcd25a964bf51fbc1649b95dff4d3627fa4818c78d04c1521c36862` |
| B: ship event log | `f9f9c66052af9f2ecaa47887ac81246f3f709b581c1485e5d43843d57c6e9ebc` |
| B: rejected supervisor JSON | `86e67dfe0839b921926bfd44d2da83ff044c1508c3eab176ca2b0aa308e5fcd9` |
| C: output-probe JSON | `6c1b176905acc20e9882629fd910ef043ff6fb084605b868a27b423c5f2840ed` |
| C: measured helper | `3eb428ca945bb10ad5e9edadb4ad74a45a776176bea3038e0e350eeab09bc4d9` |
| C: ship event log | `3a2df21ddb00da07ff1a3bee868867175ce2cf5a483a9b858db7bf9f1d3633bd` |
| D: parent rollout | `782fd10a5225629ee7175732edec072e41a5da47e44b6d883575271c3d8c90ba` |

D's `verification.json` records all three rollout hashes; `harness-replay/`
preserves the null-path diagnostic failure, `harness-replay-root-fix/` and
`harness-replay-final/` retain successful route checks with unverified plaintext.
A's supervisor answers are in the legacy process log, not individual cell files.
Reproduction flags, fresh-result-directory requirements and offline rollout
replay commands are in [the test guide](../README.md); fixture scripts and exact
prompts stay with their raw evidence. New live calls require separate approval.
