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
    # critical-review states its own output contract (communication_amendment
    # in tests/fixtures/phase-policy-baseline.json): its final message reports
    # findings and verification evidence instead of the generic update list.
    report = ('reports findings and verification evidence' if 'critical-review' in path.parts
              else 'changes, findings, checks')
    for phrase in ['Select profiles silently', report,
                   'model-selection question', 'approval artifacts']:
        if phrase not in text:
            errors.append(f'{path}: missing {phrase!r}')
    # Codex linked the instruction file that asks a question as its reason
    # (ship's handoff and start approval, 4.23.0 and 4.23.1 live checks).
    flat = ' '.join(text.split())
    if 'orchestration' in path.parts:
        phrases = ['In every message to the user — an update, a question, an approval request or the final report',
                   'never name, quote or link an instruction file of the skills you are running',
                   'unless the user asks about that file or the task is about it',
                   'give the reason itself, not the instruction that asks for it']
    else:
        phrases = ["In every message to the user, never name, quote or link this skill's instruction files"]
    for phrase in phrases:
        if phrase not in flat:
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
