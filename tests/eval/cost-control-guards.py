#!/usr/bin/env python3
"""Continue an owned live fixture to probe early guards; launch no new models.

Requires a successful new recovery run from cost-control-live.py. Preserve that
run's original artifacts. At the end, advance only its disposable candidate to
prove that stale HEAD recovery is rejected. No user repository/config is changed.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import re
import sys


def verifier_facts(summary, directory):
    facts = [json.loads(p.read_text()) for p in directory.rglob('verification-*.json')]
    for path in summary.get('states', []):
        state = json.loads(Path(path).read_text())
        facts.extend(state['tasks']['one'].get('verifierFacts', []))
    return facts


def final_exit(command):
    return command['attempts'][-1].get('exit') if command.get('attempts') else command.get('exit')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', required=True, type=Path)
    parser.add_argument('--out', type=Path, help='Fresh guard result directory inside the owned run')
    parser.add_argument('--recheck', action='store_true', help='Reassess retained runner facts without executing or changing the fixture')
    args = parser.parse_args()
    root = args.run.resolve()
    meta = json.loads((root / 'meta.json').read_text())
    prior = json.loads((root / 'outcomes.json').read_text())
    if meta['arm'] != 'new' or meta['case'] != 'recovery' or not prior.get('passed'):
        parser.error('A successful, owned new recovery run is required')
    out = args.out.resolve() if args.out else root / 'guards'
    if not out.is_relative_to(root): parser.error('--out must be inside the owned fixture run')
    if args.recheck:
        result = json.loads((out / 'outcomes.json').read_text())
        stable = json.loads((out / 'stable-directory/summary.json').read_text())
        red = json.loads((out / 'red-command/summary.json').read_text())
        result['checks']['stable_directory_verifies'] = bool(verifier_facts(stable, out / 'stable-directory')) and 'budget-exhausted' in json.dumps(stable)
        result['checks']['red_amended_command_rejected'] = any(final_exit(m) == 9 for f in verifier_facts(red, out / 'red-command') for m in f.get('mustRun', [])) and red.get('status') != 'merge-ready'
        result['passed'] = all(result['checks'].values())
        result['assessment_note'] = 'Original failed assessment retained; Codex facts are in owned state files, not Claude verification JSON paths. No runner or model rerun.'
        (out / 'assessment-v2.json').write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps({'passed': result['passed'], 'checks': result['checks']})); return 0 if result['passed'] else 1
    if out.exists(): parser.error('Guard artifacts already exist; do not repeat or overwrite')
    out.mkdir(mode=0o700)
    spec = importlib.util.spec_from_file_location('bench', Path(__file__).with_name('cost-control-live.py'))
    bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)
    original = (root / 'plan.md').read_text()
    match = re.search(r'```json wave-plan\n(.*?)\n```', original, re.S)
    plan = json.loads(match[1])
    count = len((root / 'calls.jsonl').read_text().splitlines())
    command = json.loads((root / 'first-run.argv.json').read_text())
    expected = {'no_new_model_calls': True, 'required_link_stops': True, 'missing_lock_stops': True,
                'stable_directory_verifies': True, 'red_amended_command_rejected': True,
                'restored_green_does_not_reuse_verdict': True, 'budget_change_stops': True, 'changed_head_stops': True}
    if meta['provider'] == 'codex': expected['contradictory_signing_stops_before_models'] = True
    bench.dump(out / 'expected.json', expected)
    results = {}
    latest = root / 'capped/summary.json'

    def probe(name, changed, receipt=latest):
        path = out / (name+'.plan.md')
        path.write_text(original[:match.start(1)]+json.dumps(changed, indent=2)+original[match.end(1):])
        argv = command.copy()
        argv[argv.index('--plan')+1] = str(path)
        if '--out' in argv: argv[argv.index('--out')+1] = str(out / name)
        else: argv += ['--out', str(out / name)]
        argv += ['--resume-from', str(receipt)]
        rc = bench.run_logged(argv, out, name, timeout=90)
        stderr = (out / (name+'.stderr')).read_text()+(out / (name+'.stdout')).read_text()
        summary = out / name / 'summary.json'
        body = json.loads(summary.read_text()) if summary.exists() else {}
        results[name] = {'exit': rc, 'summary': str(summary) if summary.exists() else None,
                         'stderr_artifact': str(out / (name+'.stderr')), 'status': body.get('status')}
        return rc, stderr, body, summary

    changed = copy.deepcopy(plan); changed['worktree'] = {'links': ['missing-required.properties'], 'auto': False}
    rc, text, _, _ = probe('missing-link', changed)
    checks = {'required_link_stops': rc != 0 and 'required link' in text}
    lock = out / 'disappearing.lock'; lock.write_text('locked'); lock.unlink()
    changed = copy.deepcopy(plan); changed['worktree'] = {'writable': [str(lock)], 'auto': False}
    rc, text, _, _ = probe('missing-lock', changed)
    checks['missing_lock_stops'] = rc != 0 and 'stable directory' in text
    corrected = copy.deepcopy(plan)
    if meta['provider'] == 'codex':
        changed = copy.deepcopy(plan)
        changed['waves'][0]['tasks'][0]['contract']['forbidden_moves'].append('All executor commits must be signed')
        rc, text, _, _ = probe('signing-conflict', changed)
        checks['contradictory_signing_stops_before_models'] = rc != 0 and 'unsigned executor' in text
        corrected['waves'][0]['tasks'][0]['contract']['forbidden_moves'].append('Do not change persistent signing configuration')
        (out / 'amendment-authorization.md').write_text('Disposable test only: replace the contradictory signing obligation with protection of persistent signing configuration. Keep the candidate, roles, scope and two-call cap.\n')
    corrected['worktree'] = {'writable': [str(out)], 'auto': False}
    rc, _, body, latest = probe('stable-directory', corrected)
    checks['stable_directory_verifies'] = rc != 0 and 'budget-exhausted' in json.dumps(body) and bool(verifier_facts(body, out / 'stable-directory'))
    if not latest.exists():
        bench.dump(out / 'outcomes.json', {'passed': False, 'blocked': 'No recovery summary from stable-directory probe', 'checks': checks, 'probes': results})
        print('Guard run blocked; inspect '+str(out)); return 1
    red = copy.deepcopy(corrected)
    red['waves'][0]['tasks'][0]['contract']['must_run'][0]['cmd'] += '; exit 9'
    rc, _, body, latest = probe('red-command', red, latest)
    facts = verifier_facts(body, out / 'red-command')
    checks['red_amended_command_rejected'] = rc != 0 and any(final_exit(m) == 9 for f in facts for m in f.get('mustRun', []))
    rc, _, body, latest = probe('restored-green', corrected, latest)
    checks['restored_green_does_not_reuse_verdict'] = rc != 0 and 'budget-exhausted' in json.dumps(body)
    changed = copy.deepcopy(corrected); changed['waves'][0]['limits']['max_model_calls'] = 3
    rc, text, _, _ = probe('budget-change', changed, latest)
    checks['budget_change_stops'] = rc != 0 and 'scope/roles/budget changed' in text
    saved = json.loads(latest.read_text())['recovery']['tasks']['one']
    repo = root / 'repo'; wt = Path(saved['worktree'])
    bench.git(repo, 'branch', 'evidence/original-candidate', saved['head'])
    source = wt / 'src/calc.py'; source.write_text(source.read_text()+'\n# disposable stale-HEAD probe\n')
    signing_before = bench.git(repo, 'config', '--local', '--get', 'commit.gpgsign')
    bench.git(wt, 'add', 'src/calc.py'); bench.git(wt, 'commit', '-m', 'Advance disposable candidate for guard test')
    rc, text, _, _ = probe('changed-head', corrected, latest)
    checks['changed_head_stops'] = rc != 0 and 'changed HEAD' in text
    checks['persistent_signing_unchanged'] = bench.git(repo, 'config', '--local', '--get', 'commit.gpgsign') == signing_before
    checks['no_new_model_calls'] = len((root / 'calls.jsonl').read_text().splitlines()) == count
    result = {'passed': all(checks.values()), 'checks': checks, 'probes': results,
              'scope': 'Real native runners and real committed artifacts; these guard paths intentionally invoke no models. Corrected signing is reverified at the exhausted cap, not positively re-reviewed.'}
    bench.dump(out / 'outcomes.json', result)
    print(json.dumps({'passed': result['passed'], 'checks': checks, 'evidence': str(out)}))
    return 0 if result['passed'] else 1


if __name__ == '__main__': sys.exit(main())
