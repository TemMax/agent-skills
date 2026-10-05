#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

python3 - <<'PY'
from pathlib import Path
import re

skills = [*Path('plugins/orchestration').glob('skills*/**/SKILL.md'),
          *Path('plugins/code-review').glob('skills*/**/SKILL.md')]
errors = []
for path in skills:
    text = path.read_text()
    if '### User-facing communication' not in text:
        errors.append(f'{path}: missing communication contract')
    for pattern in [r'Announce the selected profile', r'State which profile was',
                    r'Its summary must state', r'summary states the 2026-09-30 counts']:
        if re.search(pattern, text):
            errors.append(f'{path}: routine routing disclosure: {pattern}')
    for phrase in ['Select profiles silently', 'changes, findings, checks',
                   'model-selection question', 'approval artifacts']:
        if phrase not in text:
            errors.append(f'{path}: missing {phrase!r}')

for path in Path('plugins/code-review/skills/critical-review/references').glob('reviewer-*.md'):
    text = path.read_text()
    for pattern in [r'calibration\s+status belongs in the `Not verified` field',
                    r'caveat must be repeated whenever this route',
                    r'Every Luna review must state that its route is uncalibrated']:
        if re.search(pattern, text):
            errors.append(f'{path}: routine calibration disclosure')

if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: communication contract in {len(skills)} entrypoints; reviewer disclosure conflicts absent')
PY
