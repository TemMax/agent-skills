#!/usr/bin/env python3
"""Offline tests for the executor-lane driver; no model, no network."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
DRIVER = HERE / 'executor-lane.py'
REPO_ROOT = HERE.parents[1]
LINTER = REPO_ROOT / 'plugins/orchestration/skills/super-plan/references/plan-lint.mjs'
EXECUTOR = 'claude-sonnet-5-5'
MODULES = ['duration', 'paginate', 'slug', 'report']

spec = importlib.util.spec_from_file_location('executor_lane', DRIVER)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

REFERENCE = {
    'duration': '''import re

_PATTERN = re.compile(r"(?:([0-9]+)h)?(?: ?([0-9]+)m)?(?: ?([0-9]+)s)?")


def parse_duration(text):
    match = _PATTERN.fullmatch(text.strip())
    if match is None or all(group is None for group in match.groups()):
        raise ValueError(f"invalid duration: {text!r}")
    hours, minutes, seconds = (int(group) if group else 0 for group in match.groups())
    return hours * 3600 + minutes * 60 + seconds
''',
    'paginate': '''def page_count(total, per_page):
    if per_page < 1 or total < 0:
        raise ValueError("per_page must be at least 1 and total must not be negative")
    return -(-total // per_page)


def page_bounds(total, page, per_page):
    if page < 1 or page > max(1, page_count(total, per_page)):
        raise ValueError("page out of range")
    start = (page - 1) * per_page
    return (start, min(start + per_page, total))
''',
    'slug': '''import re
import unicodedata


def slugify(title, max_len=40):
    if max_len < 1:
        raise ValueError("max_len must be at least 1")
    text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    if len(slug) > max_len:
        cut = slug[:max_len]
        if slug[max_len] != "-":
            head, separator, _ = cut.rpartition("-")
            if separator:
                cut = head
        slug = cut.rstrip("-")
    return slug or "untitled"
''',
    'report': '''import json


def summarize(rows, key):
    totals = {}
    for row in rows:
        try:
            amount = float(row["amount"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"non-numeric amount: {row!r}")
        group = row[key] if key in row else "(none)"
        totals[group] = totals.get(group, 0.0) + amount
    return totals


def format_report(summary, as_json=False):
    total = sum(summary.values())
    if as_json:
        groups = {name: round(value, 2) for name, value in summary.items()}
        return json.dumps({"groups": groups, "total": round(total, 2)}, sort_keys=True)
    ordered = sorted(summary.items(), key=lambda item: (-item[1], item[0]))
    lines = [f"{name}: {value:.2f}" for name, value in ordered]
    lines.append(f"total: {total:.2f}")
    return "\\n".join(lines)
''',
}

# A claude CLI stand-in: the executor as the runner's prompt instructs, or the judge.
STUB = r'''#!__PYTHON__
import json, os, re, subprocess, sys
from pathlib import Path

argv = sys.argv[1:]
if '--version' in argv:
    print('stub-claude 0.0.0')
    sys.exit(0)
prompt = sys.stdin.read()
state = Path(os.environ['STUB_DIR'])
flag = lambda name: argv[argv.index(name) + 1] if name in argv else None
USAGE = {'input_tokens': 3, 'cache_creation_input_tokens': 20, 'cache_read_input_tokens': 100, 'output_tokens': 7}


def record(role, task, cost):
    line = json.dumps({'argv': argv, 'role': role, 'task': task, 'cost': cost}) + '\n'
    fd = os.open(state / 'calls.jsonl', os.O_WRONLY | os.O_APPEND | os.O_CREAT)
    os.write(fd, line.encode())
    os.close(fd)


def unittest_run(task, cwd):
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', f'tests.test_{task}'],
                          cwd=cwd, capture_output=True, text=True)


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), '-c', 'commit.gpgsign=false', *args],
                          capture_output=True, text=True, check=True).stdout


if '--json-schema' in argv:
    task = re.search(r'^BRANCH: wave/(\S+)$', prompt, re.M).group(1)
    green = unittest_run(task, os.getcwd()).returncode == 0
    verdict = {'ok': green, 'remarks': [], 'violations': [] if green else [
        {'class': 'must_run', 'rule': f'must_run: python3 -B -m unittest tests.test_{task}',
         'evidence': 'the command exited non-zero', 'satisfiable': True}]}
    record('judge', task, 0.004)
    print(json.dumps({'type': 'result', 'is_error': False, 'result': '', 'structured_output': verdict,
                      'usage': USAGE, 'total_cost_usd': 0.004}))
    sys.exit(0)

session = flag('--session-id') or flag('--resume')
sessions = state / 'sessions'
sessions.mkdir(exist_ok=True)
header = re.search(r'^# Task: (\S+)$', prompt, re.M)
add = re.search(r'git worktree add (\S+) -b wave/(\S+) ([0-9a-f]{40})', prompt)
if header:
    task = header.group(1)
    info = {'task': task, 'base': add.group(3), 'worktree': add.group(1)}
    (sessions / session).write_text(json.dumps(info))
else:
    info = json.loads((sessions / session).read_text())
    named = re.search(r'SAME worktree and branch \(wave/([^)]+)\)', prompt)
    task = named.group(1) if named else info['task']
worktree = Path(info['worktree'])
if not worktree.exists():
    git(os.getcwd(), 'worktree', 'add', '-b', f'wave/{task}', str(worktree), info['base'])
wrong = task in os.environ.get('STUB_WRONG', '').split(',')
source = (state / 'solutions' / (task + ('.wrong' if wrong else '') + '.py')).read_text()
(worktree / 'lane' / f'{task}.py').write_text(source)
git(worktree, 'add', '-A')
git(worktree, 'commit', '--allow-empty', '-q', '-m', f'Implement {task}')
tests = unittest_run(task, worktree)
report = '\n'.join([
    f'Changed files: lane/{task}.py', f'Gist: implemented {task} against its tests.', '',
    f'$ python3 -B -m unittest tests.test_{task}', tests.stdout + tests.stderr,
    f'$ git log --oneline {info["base"]}..HEAD', git(worktree, 'log', '--oneline', f'{info["base"]}..HEAD'),
    '$ git status --porcelain', git(worktree, 'status', '--porcelain') or '(empty)'])
record('exec', task, 0.0125)
print(json.dumps({'type': 'result', 'is_error': False, 'result': report, 'usage': USAGE, 'total_cost_usd': 0.0125}))
'''


def drive(*args, env=None):
    return subprocess.run([sys.executable, '-B', str(DRIVER), *args], capture_output=True, text=True,
                          env={**os.environ, **(env or {})}, stdin=subprocess.DEVNULL)


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def stub(self):
        state = self.tmp / 'stub-state'
        (state / 'solutions').mkdir(parents=True)
        for task, source in REFERENCE.items():
            (state / 'solutions' / f'{task}.py').write_text(source)
            (state / 'solutions' / f'{task}.wrong.py').write_text(driver.TASKS[task][1])
        cli = self.tmp / 'claude-stub'
        cli.write_text(STUB.replace('__PYTHON__', sys.executable))
        cli.chmod(0o755)
        return cli, state

    def full_run(self, name, *extra, wrong='', user_settings=True):
        cli, state = self.stub()
        out = self.tmp / name
        args = ['--executor', EXECUTOR, '--out', str(out), '--claude', str(cli), *extra]
        if user_settings:
            args.append('--user-settings')
        result = drive(*args, env={'STUB_DIR': str(state), 'STUB_WRONG': wrong})
        calls_file = state / 'calls.jsonl'
        calls = [json.loads(line) for line in calls_file.read_text().splitlines()] if calls_file.exists() else []
        return result, out, calls

    def outcomes(self, out):
        return json.loads((out / 'outcomes.json').read_text())


class FixtureTest(Case):
    def test_each_task_is_red_at_the_base_and_green_with_its_reference_solution(self):
        for task in MODULES:
            with self.subTest(task=task):
                repo = self.tmp / f'fixture-{task}'
                for relative, content in driver.fixture_files().items():
                    (repo / relative).parent.mkdir(parents=True, exist_ok=True)
                    (repo / relative).write_text(content)
                command = [sys.executable, '-B', '-m', 'unittest', f'tests.test_{task}']
                red = subprocess.run(command, cwd=repo, capture_output=True, text=True)
                self.assertNotEqual(red.returncode, 0)
                self.assertRegex(red.stderr, r'FAILED \((failures|errors)=')
                self.assertNotRegex(red.stderr, r'ImportError|SyntaxError')
                (repo / 'lane' / f'{task}.py').write_text(REFERENCE[task])
                green = subprocess.run(command, cwd=repo, capture_output=True, text=True)
                self.assertEqual(green.returncode, 0, green.stderr)
                ran = int(green.stderr.split('Ran ')[1].split(' ')[0])
                self.assertTrue(6 <= ran <= 10, f'{task} has {ran} test methods')

    def test_paginate_base_is_working_looking_with_two_bugs(self):
        namespace = {}
        exec(driver.PAGINATE_BASE, namespace)
        self.assertEqual(namespace['page_count'](11, 5), 3)
        self.assertEqual(namespace['page_count'](10, 5), 3)
        self.assertEqual(namespace['page_bounds'](11, 3, 5), (10, 15))


class PrepareOnlyTest(Case):
    def test_prepare_only_writes_the_frozen_inputs_and_makes_no_run(self):
        cli, _ = self.stub()
        out = self.tmp / 'prepared'
        result = drive('--executor', EXECUTOR, '--out', str(out), '--claude', str(cli), '--prepare-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ['plan.md', 'expected.json', 'snapshot.json', 'meta.json', 'repo', 'origin.git']:
            self.assertTrue((out / name).exists(), name)
        self.assertFalse((out / 'run').exists())
        self.assertFalse((out / 'claude-wrapper.sh').exists())
        lint = subprocess.run(['node', str(LINTER), str(out / 'plan.md'), '--repo', str(out / 'repo')],
                              capture_output=True, text=True)
        self.assertEqual(lint.returncode, 0, lint.stdout + lint.stderr)
        expected = json.loads((out / 'expected.json').read_text())
        self.assertEqual(list(expected['tasks']), MODULES)
        for task, entry in expected['tasks'].items():
            self.assertEqual(entry, {'module': f'lane/{task}.py', 'base_red': True,
                                     'must_run': f'python3 -B -m unittest tests.test_{task}'})
        meta = json.loads((out / 'meta.json').read_text())
        self.assertEqual(meta['plugin_version'],
                         json.loads((REPO_ROOT / 'plugins/orchestration/.claude-plugin/plugin.json').read_text())['version'])
        self.assertEqual(meta['cli_version'], 'stub-claude 0.0.0')
        self.assertEqual((meta['executor'], meta['supervision'], meta['max_attempts']), (EXECUTOR, 'mechanical', 2))
        self.assertEqual(len(meta['git_head']), 40)
        snapshot = json.loads((out / 'snapshot.json').read_text())
        self.assertIn('skills/multi-model/references/claude-wave-runner.mjs', snapshot)
        self.assertFalse(any('__pycache__' in name or name.endswith('.pyc') for name in snapshot))

    def test_plan_shape_follows_the_supervision_mode(self):
        cli, _ = self.stub()
        for mode in ['mechanical', 'model']:
            out = self.tmp / f'plan-{mode}'
            result = drive('--executor', EXECUTOR, '--out', str(out), '--claude', str(cli), '--prepare-only',
                           '--supervision', mode, '--max-attempts', '3')
            self.assertEqual(result.returncode, 0, result.stderr)
            text = (out / 'plan.md').read_text()
            self.assertTrue(text.startswith('status: draft\nbase: pending\n'))
            plan = json.loads(text.split('```json wave-plan\n')[1].split('\n```')[0])
            wave = plan['waves'][0]
            self.assertEqual(wave['limits'], {'max_attempts': 3, 'max_model_calls': 6})
            self.assertEqual(wave['supervisor'], {'model': 'claude-opus-5-5', 'effort': 'high'})
            for task in wave['tasks']:
                contract = task['contract']
                self.assertEqual(task['executor'], {'model': EXECUTOR, 'effort': 'medium'})
                self.assertEqual((task['ladder'], task['branch']), ([], f'wave/{task["id"]}'))
                self.assertEqual(contract['files_allowed'], [f'lane/{task["id"]}.py'])
                self.assertEqual(contract['files_forbidden'], ['tests/**'])
                if mode == 'mechanical':
                    self.assertEqual(task['supervision'], 'mechanical')
                    self.assertEqual((contract['forbidden_moves'], contract['report_must_answer']), ([], []))
                else:
                    self.assertNotIn('supervision', task)
                    self.assertEqual(len(contract['forbidden_moves']), 1)
                    self.assertEqual(contract['report_must_answer'], ['Which function changed and how?'])
                self.assertIn(f'## Task {task["id"]}\n', text)
            self.assertTrue(text.count('Keep the tests unchanged.') == 4)

    def test_nonempty_out_exits_73_and_writes_nothing(self):
        cli, _ = self.stub()
        out = self.tmp / 'taken'
        out.mkdir()
        (out / 'keep.txt').write_text('mine')
        result = drive('--executor', EXECUTOR, '--out', str(out), '--claude', str(cli))
        self.assertEqual(result.returncode, 73)
        self.assertIn('not empty', result.stderr)
        self.assertEqual([p.name for p in out.iterdir()], ['keep.txt'])


class FullRunTest(Case):
    def test_correct_solutions_pass_on_the_first_attempt(self):
        result, out, calls = self.full_run('green')
        self.assertEqual(result.returncode, 0, result.stderr)
        outcomes = self.outcomes(out)
        self.assertEqual(outcomes['status'], 'done')
        self.assertEqual(outcomes['runner_exit'], 0)
        self.assertTrue(outcomes['snapshot_unchanged'])
        self.assertGreater(outcomes['wall_seconds'], 0)
        self.assertEqual(list(outcomes['tasks']), MODULES)
        for task, entry in outcomes['tasks'].items():
            with self.subTest(task=task):
                self.assertEqual(entry, {'status': 'ok', 'executor_calls': 1, 'judge_calls': 0,
                                         'first_attempt_ok': True, 'independent_green': True, 'paths_ok': True})
        self.assertEqual(outcomes['totals'], {'ok': 4, 'first_attempt_ok': 4, 'failed': 0})
        self.assertAlmostEqual(outcomes['reported_cost_usd'], sum(call['cost'] for call in calls))
        self.assertEqual(outcomes['usage'], {'input': 12, 'cacheCreation': 80, 'cacheRead': 400, 'output': 28})
        self.assertEqual([call['role'] for call in calls], ['exec'] * 4)
        self.assertFalse((out / 'check').exists())
        for name in ['runner.stdout', 'runner.stderr', 'runner.json']:
            self.assertTrue((out / name).exists(), name)
        self.assertEqual(json.loads((out / 'runner.json').read_text())['exit'], 0)

    def test_wrong_solution_is_a_measurement_not_a_driver_failure(self):
        result, out, calls = self.full_run('wrong', wrong='slug')
        self.assertEqual(result.returncode, 0, result.stderr)
        outcomes = self.outcomes(out)
        slug = outcomes['tasks']['slug']
        self.assertNotEqual(slug['status'], 'ok')
        self.assertFalse(slug['independent_green'])
        self.assertFalse(slug['first_attempt_ok'])
        self.assertGreaterEqual(slug['judge_calls'], 1)
        self.assertEqual(slug['executor_calls'], 2)
        for task in ['duration', 'paginate', 'report']:
            self.assertEqual(outcomes['tasks'][task]['status'], 'ok', task)
            self.assertTrue(outcomes['tasks'][task]['independent_green'])
        self.assertEqual(outcomes['totals'], {'ok': 3, 'first_attempt_ok': 3, 'failed': 1})
        self.assertNotEqual(outcomes['runner_exit'], 0)
        self.assertAlmostEqual(outcomes['reported_cost_usd'], sum(call['cost'] for call in calls))
        # The rework resumed the executor session instead of resending the task.
        resumed = [call for call in calls if call['role'] == 'exec' and '--resume' in call['argv']]
        self.assertEqual([call['task'] for call in resumed], ['slug'])

    def test_without_user_settings_the_cli_runs_through_the_wrapper(self):
        result, out, calls = self.full_run('wrapped', user_settings=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        wrapper = out / 'claude-wrapper.sh'
        self.assertEqual(wrapper.stat().st_mode & 0o777, 0o755)
        self.assertTrue(calls)
        for call in calls:
            self.assertEqual(call['argv'][-2:], ['--setting-sources', ''])
        self.assertEqual(self.outcomes(out)['totals']['ok'], 4)

    def test_user_settings_pass_the_cli_through_unchanged(self):
        _, _, calls = self.full_run('plain')
        self.assertTrue(calls)
        self.assertTrue(all('--setting-sources' not in call['argv'] for call in calls))

    def test_runner_without_a_summary_is_a_blocked_run(self):
        out = self.tmp / 'blocked'
        result = drive('--executor', EXECUTOR, '--out', str(out), '--claude', '/nonexistent/claude',
                       '--user-settings')
        self.assertEqual(result.returncode, 1)
        self.assertIn('no readable summary', result.stderr)
        self.assertFalse((out / 'outcomes.json').exists())


if __name__ == '__main__':
    unittest.main()
