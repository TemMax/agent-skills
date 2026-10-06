#!/usr/bin/env python3
"""Recheck communication in retained native traces without calling a host CLI."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

SCORER = Path(__file__).with_name('acceptance-dialogue-live.py')
spec = importlib.util.spec_from_file_location('dialogue', SCORER)
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replay(runs, out):
    inputs = []
    for run in runs:
        run = Path(run).resolve()
        files = sorted((p for p in run.glob('turn-*.jsonl') if re.fullmatch(r'turn-\d+\.jsonl', p.name)),
                       key=lambda p: int(p.stem.split('-')[-1]))
        if not files or [int(p.stem.split('-')[-1]) for p in files] != list(range(1, len(files)+1)):
            raise ValueError(f'Expected consecutive native traces starting at turn-1: {run}')
        outcome = run / 'outcomes.json'
        original = json.loads(outcome.read_text()) if outcome.exists() else {}
        evidence = files + ([outcome] if outcome.exists() else [])
        inputs.append((run, files, original.get('checks', {}).get('quiet'), {p: digest(p) for p in evidence}))
    out = Path(out).resolve()
    if any(out == run or run in out.parents for run, *_ in inputs):
        raise ValueError('Replay output must be outside the retained run directories')
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    results = []
    for number, (run, files, original_quiet, hashes) in enumerate(inputs, 1):
        communication = a.communication_checks([a.read_events(p) for p in files])
        entry = {'run': str(run), 'turn_count': len(files), 'original_quiet': original_quiet,
                 'quiet': communication['quiet'],
                 'changed': isinstance(original_quiet, bool) and original_quiet != communication['quiet'],
                 'input_sha256': {p.name: sha for p, sha in hashes.items()}}
        a.bench.dump(out / f'run-{number}.json', {**entry, **communication})
        if any(digest(p) != sha for p, sha in hashes.items()):
            raise RuntimeError(f'Retained evidence changed during replay: {run}')
        results.append(entry)
    summary = {'new_model_calls': 0, 'scope': 'Communication only; other live checks are not revalidated.',
               'scorer_sha256': digest(SCORER), 'run_count': len(results),
               'turn_count': sum(r['turn_count'] for r in results),
               'changed_count': sum(r['changed'] for r in results), 'runs': results}
    a.bench.dump(out / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runs', nargs='+', type=Path)
    parser.add_argument('--out', required=True, type=Path, help='Fresh output directory; retained evidence is never overwritten')
    args = parser.parse_args()
    result = replay(args.runs, args.out)
    print(json.dumps({k: result[k] for k in ['run_count', 'turn_count', 'changed_count', 'new_model_calls']}))


if __name__ == '__main__': main()
