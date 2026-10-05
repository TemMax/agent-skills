#!/usr/bin/env python3
"""One bounded, multi-turn Claude Code session on the shared Codex A/B fixture.

Manual/live only. Defaults to a two-turn smoke, not the costly eight-turn task.
old: git snapshot (--old-ref HEAD); new: current files or explicit --new-ref;
real: installed plugins. Snapshots use normal --plugin-dir loading, including hooks.
Authentication stays with the native CLI. Does not change installed plugins.
"""
import argparse
import ast
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import uuid
from claude_session_events import analyze, final_result, read_events, skill_loads

ROOT = Path(__file__).resolve().parents[2]
TAIL = ('В этом репозитории много дублирующихся unit-тестов. Удали тесты, которые дублируют другие '
        'и не ловят отдельных багов, распределив аудит по параллельным подагентам. '
        'Отвечай на русском. PR не открывай.')
CI_EDIT = 'Теперь отдельная мелкая правка: в .github/workflows/ci.yml поменяй timeout-minutes с 10 на 15.'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashes(root):
    return {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob('*')) if p.is_file()}


def run_git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def execute(cmd, cwd, prompt, out, k, timeout, env):
    (out / f'turn-{k}.prompt').write_text(prompt)
    (out / f'turn-{k}.cmd').write_text(shlex.join(cmd)+'\n')
    started = time.monotonic()
    with (out / f'turn-{k}.jsonl').open('w') as stream, (out / f'turn-{k}.err').open('w') as err:
        proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                stdout=stream, stderr=err, text=True, start_new_session=True)
        try:
            proc.communicate(prompt, timeout=timeout)
            rc = proc.returncode
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            # Kill the whole process group: a runner/subagent must not outlive a timed-out turn.
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
            rc = 124
    return rc, round(time.monotonic()-started, 2)


def capture_transcripts(out, sid, projects):
    # Search only filenames for this exact UUID; never read unrelated conversations.
    if projects.is_dir():
        for project in projects.iterdir():
            if not project.is_dir():
                continue
            transcript = project / f'{sid}.jsonl'
            if transcript.is_file():
                shutil.copyfile(transcript, out / 'rollout.jsonl')
                children = project / sid / 'subagents'
                if children.is_dir():
                    for p in children.rglob('agent-*.jsonl'):
                        dest = out / 'child-rollouts' / p.relative_to(children)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(p, dest)
                return


def test_methods(repo):
    methods = {}
    for p in sorted((repo / 'tests').glob('test_*.py')):
        tree = ast.parse(p.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name.startswith('test_'):
                methods[node.name] = ast.dump(ast.Module(body=node.body, type_ignores=[]), include_attributes=False)
    return methods


def outcomes(out, expected, complete):
    repo = out / 'repo'
    try:
        methods = test_methods(repo)
        ci = (repo / '.github/workflows/ci.yml').read_text()
        tests = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests'],
                               cwd=repo, capture_output=True, text=True, timeout=30)
        (out / 'fixture-tests.log').write_text(tests.stdout+tests.stderr)
        checks = {'tests_pass': tests.returncode == 0,
                  'product_code_unchanged': {str(p.relative_to(repo / 'calc')): sha(p) for p in (repo / 'calc').glob('*.py')} == expected['product'],
                  'ci_timeout': bool(re.search(r'timeout-minutes:\s*15\b', ci)),
                  'ci_only_requested_change': ci == expected['ci'].replace('timeout-minutes: 10', 'timeout-minutes: 15')}
        if expected['scenario'] == 'smoke':
            checks['all_original_tests_preserved'] = methods == expected['methods']
        else:
            groups = expected['duplicate_groups']
            grouped = {n for group in groups for n in group}
            checks['unique_cases_preserved'] = all(methods.get(n) == body for n, body in expected['methods'].items() if n not in grouped)
            checks['one_per_duplicate_group'] = all(sum(n in methods for n in group) == 1 for group in groups)
            checks['retained_tests_unchanged'] = all(body == expected['methods'].get(n) for n, body in methods.items())
            checks['test_count'] = len(methods) == 14
        passed = all(checks.values()) if complete else None
        result = {'status': ('passed' if passed else 'failed') if complete else 'partial',
                  'passed': passed, 'checks': checks, 'test_count': len(methods)}
    except Exception as e:
        result = {'status': 'failed', 'passed': False, 'error': str(e)}
    write_json(out / 'outcomes.json', result)
    with (out / 'final-state.txt').open('w') as f:
        for cmd in (['git', 'log', '--oneline', '--all'], ['git', 'status', '--porcelain'],
                    ['git', 'worktree', 'list'], ['git', 'diff', 'HEAD'],
                    ['git', 'diff', 'origin/main']):
            f.write('## '+shlex.join(cmd)+'\n')
            result_cmd = subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
            f.write(result_cmd.stdout+result_cmd.stderr+'\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--arm', required=True, choices=['old', 'new', 'real'])
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--old-ref', default='HEAD')
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--new-ref')
    source.add_argument('--candidate-root', type=Path, help='Plugin directory; default current plugins/orchestration, including uncommitted files')
    parser.add_argument('--scenario', choices=['smoke', 'duplicates'], default='smoke')
    parser.add_argument('--rep', type=int, default=1, help='Repetition label; one session per invocation')
    parser.add_argument('--model', default='claude-sonnet-5-5')
    parser.add_argument('--effort', default='medium')
    parser.add_argument('--turns', type=int)
    parser.add_argument('--turn-timeout', type=int, default=300)
    parser.add_argument('--max-budget-usd', type=float, default=5, help='Cumulative print-mode CLI budget; shell-launched child CLIs are outside it')
    args = parser.parse_args()
    count = 2 if args.scenario == 'smoke' else 8
    turns = args.turns or count
    if (args.turns is not None and not 1 <= args.turns <= count) or args.rep < 1 or args.turn_timeout < 1 or not 0 < args.max_budget_usd < float('inf'):
        parser.error('positive repetition, timeout, finite budget and valid turn count required')
    if args.arm != 'new' and (args.candidate_root or args.new_ref):
        parser.error('--candidate-root / --new-ref only apply to arm new')
    cli = shutil.which(os.environ.get('SKILL_SESSION_AB_CLAUDE_BIN', 'claude'))
    if not cli:
        print('Claude executable unavailable', file=sys.stderr)
        return 69
    out = args.out.resolve()
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        print(f'Refusing nonempty result directory: {out}', file=sys.stderr)
        return 73
    archive, candidate, ref, commit = None, None, None, None
    try:
        if args.arm == 'old' or (args.arm == 'new' and args.new_ref):
            ref = args.old_ref if args.arm == 'old' else args.new_ref
            commit = run_git('rev-parse', '--verify', ref+'^{commit}').decode().strip()
            archive = run_git('archive', commit, 'plugins/orchestration')
        elif args.arm == 'new':
            candidate = (args.candidate_root or ROOT / 'plugins/orchestration').resolve()
            if out.is_relative_to(candidate):
                raise ValueError('--out must be outside the candidate plugin tree')
            if not (candidate / 'skills/multi-model/SKILL.md').is_file():
                raise ValueError('candidate has no Claude multi-model entrypoint')
            if any(p.is_symlink() for p in candidate.rglob('*')):
                raise ValueError('candidate symlinks are not supported by immutable snapshots')
            json.loads((candidate / '.claude-plugin/plugin.json').read_text())
    except (ValueError, OSError, subprocess.CalledProcessError) as e:
        parser.error(str(e))
    os.umask(0o077)
    out.mkdir(parents=True, exist_ok=True)
    plugin = out / 'plugin'
    if archive is not None:
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(out / 'archive', filter='data')
        shutil.move(str(out / 'archive/plugins/orchestration'), plugin)
        shutil.rmtree(out / 'archive')
    elif candidate:
        shutil.copytree(candidate, plugin, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    manifest = None
    if plugin.exists():
        manifest = {'source': str(candidate) if candidate else ref, 'commit': commit,
                    'version': json.loads((plugin / '.claude-plugin/plugin.json').read_text())['version'],
                    'sha256': hashes(plugin)}
    env = dict(os.environ)
    env.pop('CLAUDECODE', None)
    env.pop('CLAUDE_CODE_SAFE_MODE', None)
    repo = out / 'repo'
    with (out / 'run.log').open('w') as log:
        subprocess.run(['bash', '-e', '-c', '. "$1"; make_repo "$2"', 'fixture',
                        str(ROOT / 'tests/eval/lib/skill-session-fixture.sh'), str(repo)],
                       stdout=log, stderr=log, check=True, env=env)
    # Ignore bytecode in hashes; executable product code must remain unchanged.
    product = {str(p.relative_to(repo / 'calc')): sha(p) for p in (repo / 'calc').glob('*.py')}
    expected = {'scenario': args.scenario, 'product': product, 'methods': test_methods(repo),
                'ci': (repo / '.github/workflows/ci.yml').read_text(),
                'duplicate_groups': [['test_add_two', 'test_add_two_again', 'test_mul_rechecks_add'],
                                     ['test_mul_basic', 'test_mul_basic_duplicate'],
                                     ['test_fmt_two_decimals', 'test_fmt_two_decimals_copy', 'test_fmt_pi_again']]}
    write_json(out / 'expected.json', expected)
    sid = str(uuid.uuid4())
    version = subprocess.run([cli, '--version'], capture_output=True, text=True, timeout=15).stdout.strip()
    meta = {'provider': 'claude', 'arm': args.arm, 'rep': args.rep, 'scenario': args.scenario,
            'requested_turns': turns,
            'model': args.model, 'effort': args.effort, 'session_id': sid, 'cli_version': version,
            'candidate': manifest, 'turn_timeout': args.turn_timeout, 'max_budget_usd': args.max_budget_usd,
            'started': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    write_json(out / 'meta.json', meta)
    (out / 'meta.txt').write_text(f'arm={args.arm}\nthread_id={sid}\nprovider=claude\nscenario={args.scenario}\n')
    invoke = 'Используй скилл orchestration:multi-model. '
    if args.scenario == 'duplicates':
        prompts = [invoke+TAIL, 'да', 'продолжай', 'да', 'продолжай', CI_EDIT, 'да', 'продолжай']
    else:
        prompts = [invoke+'Сейчас только прочитай README.md и .github/workflows/ci.yml, назови текущий timeout-minutes. '
                   'Файлы не меняй, агентов не запускай. Отвечай кратко на русском. PR не открывай.',
                   CI_EDIT+' Это одиночная правка, сделай её сам и проверь результат. PR не открывай.']
    common = [cli, '-p', '--verbose', '--output-format', 'stream-json', '--model', args.model,
              '--effort', args.effort, '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
              '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent,Task', '--no-chrome']
    if plugin.exists():
        common += ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                   '--plugin-dir', str(plugin)]
    spent, ok, failure, observed, all_cost_known = 0.0, True, None, [], True
    with (out / 'turns.tsv').open('w') as tab:
        tab.write('turn\texit\tcompleted\tseconds\n')
        for k, prompt in enumerate(prompts[:turns], 1):
            remaining = args.max_budget_usd-spent
            if remaining <= 0:
                ok, failure = False, 'cumulative CLI budget exhausted'
                break
            cmd = common+['--max-budget-usd', str(remaining)]+(['--session-id', sid] if k == 1 else ['--resume', sid])
            print(f'turn {k}/{turns} start', file=sys.stderr, flush=True)
            rc, seconds = execute(cmd, repo, prompt, out, k, args.turn_timeout, env)
            rows = read_events(out / f'turn-{k}.jsonl')
            observed.extend(rows)
            result = final_result(rows)
            ids = {r['session_id'] for r in rows if r.get('session_id')}
            done = rc == 0 and result.get('subtype') == 'success' and not result.get('is_error') and ids == {sid}
            cost = result.get('total_cost_usd')
            measured_cost = isinstance(cost, (int, float)) and math.isfinite(cost) and cost >= 0
            if measured_cost:
                spent += cost
            else:
                all_cost_known = False
                done = False
            tab.write(f'{k}\t{rc}\t{int(done)}\t{seconds}\n'); tab.flush()
            print(f'turn {k}: exit={rc}, completed={done}, {seconds}s', file=sys.stderr, flush=True)
            if not done:
                ok, failure = False, f'turn {k}: {result.get("subtype", "missing result")}, exit={rc}, session_match={ids == {sid}}, cost_known={measured_cost}'
                break
    projects = Path(os.environ.get('SKILL_SESSION_AB_CLAUDE_PROJECTS', str(Path.home() / '.claude/projects')))
    capture_transcripts(out, sid, projects)
    if (out / 'rollout.jsonl').exists():
        observed.extend(read_events(out / 'rollout.jsonl'))
    # Exact file/path evidence, not merely an advertised name or a claimed version in the answer.
    inits = [p for r in observed if r.get('subtype') == 'init' for p in r.get('plugins', [])]
    advertised = any(p.get('path') == str(plugin) and p.get('version') == manifest['version'] for p in inits) if manifest else None
    loaded = {'snapshot_path_observed': str(plugin / 'skills/multi-model') in skill_loads(observed) if plugin.exists() else None,
              'candidate_advertised': advertised,
              'snapshot_unchanged': hashes(plugin) == manifest['sha256'] if manifest else None,
              'plugin_init': [r.get('plugins', []) for r in observed if r.get('subtype') == 'init']}
    write_json(out / 'loaded-candidate.json', loaded)
    if manifest and not all(loaded[k] for k in ('snapshot_path_observed', 'candidate_advertised', 'snapshot_unchanged')):
        ok, failure = False, 'candidate version/path/load not established or snapshot changed'
    result = outcomes(out, expected, ok and turns == count)
    status = {'completed': ok, 'full_scenario': ok and turns == count, 'failure': failure,
              'reported_cost_usd': spent if all_cost_known else None,
              'known_reported_cost_usd': spent, 'outcomes': result['status']}
    write_json(out / 'run-status.json', status)
    analyze(out)
    print(f'Evidence: {out}', file=sys.stderr)
    return 0 if ok and result['passed'] is not False else 1


if __name__ == '__main__':
    sys.exit(main())
