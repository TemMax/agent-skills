#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

python3 - <<'PY'
from pathlib import Path
import runpy
skill_text = runpy.run_path("tests/lib/skill-source.py")["skill_text"]

for tree in ['skills', 'skills-codex']:
    path = Path(f'plugins/orchestration/{tree}/multi-model/SKILL.md')
    text = skill_text(path)
    for phrase in ['### Cost discipline', 'remarks alone do not launch rework',
                   'affected checks', 'fresh child context', 'measured usage']:
        assert phrase in text, f'{path}: missing {phrase!r}'

path = Path('plugins/orchestration/skills/multi-model/references/supervisor-prompt.md')
text = path.read_text()
for phrase in ['independent VERIFIER FACTS cover this candidate and every `must_run` command',
               'recorded HEAD, it must match the task commit',
               '**Matching independent facts:** use those results for `must_run`.',
               '**Absent, incomplete or inconsistent facts:**',
               'A re-run needs a concrete reason', 'Do not expand the contract']:
    assert phrase in text, f'{path}: missing {phrase!r}'
print('PASS: scoped rework, context, usage and supervisor checks')
PY
