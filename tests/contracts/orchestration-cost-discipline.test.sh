#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

python3 - <<'PY'
from pathlib import Path

for tree in ['skills', 'skills-codex']:
    path = Path(f'plugins/orchestration/{tree}/multi-model/SKILL.md')
    text = path.read_text()
    for phrase in ['### Cost discipline', 'remarks alone do not launch rework',
                   'affected checks', 'fresh child context', 'measured usage']:
        assert phrase in text, f'{path}: missing {phrase!r}'

path = Path('plugins/orchestration/skills/multi-model/references/supervisor-prompt.md')
text = path.read_text()
for phrase in ['When independent verifier facts match the branch and ordered pipeline',
               'A re-run needs a concrete reason', 'Do not expand the contract']:
    assert phrase in text, f'{path}: missing {phrase!r}'
print('PASS: scoped rework, context, usage and supervisor checks')
PY
