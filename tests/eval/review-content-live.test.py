#!/usr/bin/env python3
"""Offline checks of review-content-live.py's answer analysis."""
import importlib.util
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('review_live', Path(__file__).with_name('review-content-live.py'))
live = importlib.util.module_from_spec(spec); spec.loader.exec_module(live)

HEADER = '| Tier | Finding | Location | Why / failure scenario | Suggested fix |\n|---|---|---|---|---|\n'


def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    return cond


ok = True
a = live.analyze(HEADER + '| Important | Crash on empty list | `src/ratings.py:3` | ZeroDivisionError | guard |\n\nSet aside: none\n')
ok &= check('Important row on the module counts', a['empty_input_tiers'] == ['Important'] and a['set_aside_line'])
a = live.analyze(HEADER + '| Low | Tests miss the empty list | `tests/test_ratings.py:6` | Important gap | add |\n')
ok &= check('a row on the test file is not the finding', a['empty_input_rows'] == [])
a = live.analyze(HEADER + '| Nit | Mention Important empty case | `ratings.py:3` | empty | x |\n')
ok &= check('the tier comes from the Tier cell', a['empty_input_tiers'] == ['Nit'])
a = live.analyze('| Check | Result |\n|---|---|\n| src/ratings.py empty input plan-mandated | ok |\n')
ok &= check('rows of another table are ignored', a['empty_input_rows'] == [] and not a['plan_mandated_row'])
a = live.analyze(HEADER + '| **Important** (`plan-mandated`) | 0.0 for no reviews | `src/ratings.py:3` | empty list | None |\n')
ok &= check('bold tier and plan-mandated label are read', a['empty_input_tiers'] == ['Important'] and a['plan_mandated_row'])
a = live.analyze('Verdict: clean.\n')
ok &= check('no table means no finding and no Set aside line', a['finding_rows'] == 0 and not a['set_aside_line'])
raise SystemExit(0 if ok else 1)
