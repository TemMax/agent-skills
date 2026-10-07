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
    for phrase in ['Skip Step 0,', 'Review-fix rules apply only to findings of a review the user asked for in',
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

python3 - <<'PY'
from pathlib import Path
import re
import runpy
import json
import hashlib
import tempfile
skill_text=runpy.run_path('tests/lib/skill-source.py')['skill_text']
norm=lambda s: re.sub(r'\s+', ' ', s).strip()
baseline=json.loads(Path('tests/fixtures/phase-policy-baseline.json').read_text())
for tree in ['skills','skills-codex']:
    for plugin,name in [('orchestration','super-plan'),('orchestration','ship'),('code-review','critical-review')]:
        p=Path('plugins')/plugin/tree/name/'SKILL.md'
        entry=p.read_text(); combined=skill_text(p)
        # Bounded at 7.5 KB including the tested positive communication contract.
        assert len(entry.encode()) < 7500, f'{p}: entrypoint grew'
        # Fingerprints of pre-split paragraphs work in shallow clones/archives too.
        actual={hashlib.sha256(norm(block).encode()).hexdigest()
                for block in re.split(r'\n\s*\n',combined) if norm(block)}
        for expected in baseline['policy_paragraph_sha256'][str(p)]:
            assert expected in actual, f'{p}: lost pre-split policy paragraph {expected}'
        if name=='critical-review':
            for phase in ['PROFILE.md','REVIEW.md','PR.md','FIXES.md']:
                assert f']({phase})' in entry
            assert 'Before every review' in entry and 'Only then inspect code or a diff' in entry
            assert 'before reading any code or diff' in entry
            assert 'explicitly asks' in entry
            assert '## Post-Review Fix Protocol' not in entry
        else:
            assert ']('+'WORKFLOW.md)' in entry
            assert '## Plan Format' not in entry
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            for src in p.parent.glob('*.md'): (d/src.name).write_bytes(src.read_bytes())
            phase='PROFILE.md' if name=='critical-review' else 'WORKFLOW.md'
            (d/phase).unlink()
            try: skill_text(d/'SKILL.md')
            except FileNotFoundError: pass
            else: raise AssertionError(f'{p}: missing {phase} accepted')
print('PASS: six bounded entrypoints; every pre-split policy paragraph reachable; missing phases fail')
PY
