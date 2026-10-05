#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

python3 - <<'PY'
from pathlib import Path
import runpy
import tempfile

skill_text = runpy.run_path('tests/lib/skill-source.py')['skill_text']
for tree in ['skills', 'skills-codex']:
    path = Path('plugins/orchestration') / tree / 'multi-model/SKILL.md'
    entry = path.read_text()
    assert len(entry.encode()) < 12000, f'{path}: hot entrypoint expanded'
    for phrase in ['Skip Step 0,', 'This exception does not cover review fixes',
                   'load [WORKFLOW.md](WORKFLOW.md) once.',
                   'approval, recovery and integration rules are mandatory.']:
        assert phrase in entry, f'{path}: missing task boundary {phrase!r}'
    assert '## Task Prompt Template' not in entry
    assert '## Supervised Waves' not in entry
    combined = skill_text(path)
    for phrase in ['files_allowed', 'report_must_answer', '## Supervised Waves']:
        assert phrase.lower() in combined.lower(), f'{path}: delegated contract unreachable: {phrase}'

with tempfile.TemporaryDirectory() as tmp:
    missing = Path(tmp) / 'SKILL.md'
    missing.write_text('load [WORKFLOW.md](WORKFLOW.md) once.')
    try:
        skill_text(missing)
    except FileNotFoundError:
        pass
    else:
        raise AssertionError('Missing mandatory workflow silently accepted')
print('PASS: bounded entrypoints, mandatory delegated contracts, missing-resource rejection')
PY
