#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SP="plugins/orchestration/skills/super-plan/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "the skill exists" \
  "[ -f $SP ]"

check "the plan format paragraph is corrected: read by the runners and validated by the linter" \
  "one_line '$SP' | grep -qF 'read by the runners and validated by the linter (shape errors fail lint)'"

check "the plan format paragraph no longer says the linter checks these by a required-key rule" \
  "! one_line '$SP' | grep -qF \"rather than checked by the linter's required-key rule\""

check "the inherits bullet is corrected: for the runners and the linter" \
  "one_line '$SP' | grep -qF 'takes them from the parent for the runners and the linter.'"

check "the inherits bullet no longer names the linter's --base flag" \
  "! one_line '$SP' | grep -qF \"the linter's \\\`--base\\\`\""

check "the seam audit lists implementers of a changed interface" \
  "one_line '$SP' | grep -qF 'implementers'"

check "the seam audit lists fakes and test doubles" \
  "one_line '$SP' | grep -qF 'fakes'"

check "the seam audit's implementers check gives the measured AppRouter cost" \
  "one_line '$SP' | grep -qF 'broke fakes in 9 modules, costing 2 fix waves'"

check "the seam audit requires forbidden_moves pre-authorization by name" \
  "one_line '$SP' | grep -qF 'pre-authorized by name'"

check "the seam audit forbids a forbidden_moves entry that contradicts the prose" \
  "one_line '$SP' | grep -qF 'No \`forbidden_moves\` entry may forbid what the prose requires'"

check "the seam audit cites the build tool's own task listing" \
  "one_line '$SP' | grep -qF 'tasks --all'"

check "the seam audit cites the measured nonexistent jvmTest target" \
  "one_line '$SP' | grep -qF ':core-mobile:jvmTest'"

check "the seam audit requires depends_on entries to name a real producer" \
  "one_line '$SP' | grep -qF 'names a real producer (repo, ref, path)'"

check "there is a Converting an existing plan section" \
  "one_line '$SP' | grep -qF 'Converting an existing plan'"

check "converting an existing plan forbids git commit steps and copied checkbox lists" \
  "one_line '$SP' | grep -qF 'no \`git commit\` steps, no checkbox step lists copied as waves'"

check "converting an existing plan cites the measured superpowers-draft crash" \
  "one_line '$SP' | grep -qF 'string-patching a superpowers draft seeded a heading crash'"

check "acceptance references require an owner checkpoint via a contact sheet" \
  "one_line '$SP' | grep -qF 'contact sheet'"

check "the contact sheet check cites the measured baked-in-background icons" \
  "one_line '$SP' | grep -qF 'icons exported with baked-in backgrounds reached the PR'"

check "acceptance references name interaction triggers as Gate 1 product forks" \
  "one_line '$SP' | grep -qF 'Interaction triggers'"

check "the interaction-triggers check cites the measured collapse-on-scroll" \
  "one_line '$SP' | grep -qF 'a collapse-on-scroll the user did not want shipped silently'"

check "common mistakes covers a missing CI gate in must_run" \
  "one_line '$SP' | grep -qF 'A missing CI gate in \`must_run\`'"

check "common mistakes covers an unlisted fake of a changed interface" \
  "one_line '$SP' | grep -qF 'An unlisted fake of a changed interface'"

check "common mistakes covers prose contradicting forbidden_moves" \
  "one_line '$SP' | grep -qF 'Prose contradicting \`forbidden_moves\`'"

check "common mistakes covers a titled Task heading" \
  "one_line '$SP' | grep -qF 'A titled \`## Task\` heading'"

check "common mistakes covers a main-checkout-only preflight" \
  "one_line '$SP' | grep -qF 'A main-checkout-only preflight'"

summary
