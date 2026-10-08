#!/usr/bin/env python3
"""Live executor-lane driver: one real wave of four small closed tasks.

Runs the candidate native Claude runner (from a frozen snapshot of the working
tree's plugins/orchestration) with a chosen executor model and records what
happened. It measures; it does not decide whether the model is good enough.

Exit codes: 0 measured (task statuses may be anything), 1 blocked (no readable
summary or the snapshot changed), 65 the generated plan failed the linter,
70 fixture defect (a task is green at the base), 73 --out exists and is not empty.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time

REPO_ROOT = Path(__file__).resolve().parents[2]
PLUGIN = Path('plugins/orchestration')
IGNORE = ('__pycache__', '*.pyc')

GITIGNORE = '.worktrees/\n__pycache__/\n*.pyc\n'
README = '# lane fixture\n\nFour small independent modules with their tests.\n'

DURATION_BASE = '''def parse_duration(text: str) -> int:
    raise NotImplementedError
'''

DURATION_TEST = '''import unittest

from lane.duration import parse_duration


class ParseDurationTest(unittest.TestCase):
    def test_seconds(self):
        self.assertEqual(parse_duration("90s"), 90)
        self.assertEqual(parse_duration("0s"), 0)

    def test_minutes(self):
        self.assertEqual(parse_duration("2m"), 120)

    def test_hours_and_minutes(self):
        self.assertEqual(parse_duration("1h30m"), 5400)

    def test_groups_separated_by_spaces(self):
        self.assertEqual(parse_duration("1h 30m 15s"), 5415)

    def test_surrounding_whitespace_is_ignored(self):
        self.assertEqual(parse_duration(" 45m "), 2700)

    def test_empty_and_unknown_text(self):
        for text in ["", "abc", "5x"]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_duration(text)

    def test_negative_and_fractional_numbers(self):
        for text in ["-3s", "1.5h"]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_duration(text)

    def test_units_out_of_order_or_repeated(self):
        for text in ["1m1h", "1h1h"]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_duration(text)

    def test_number_or_unit_missing(self):
        for text in ["h", "10"]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_duration(text)


if __name__ == "__main__":
    unittest.main()
'''

PAGINATE_BASE = '''def page_count(total: int, per_page: int) -> int:
    if per_page < 1 or total < 0:
        raise ValueError("per_page must be at least 1 and total must not be negative")
    return total // per_page + 1


def page_bounds(total: int, page: int, per_page: int) -> tuple:
    if page < 1:
        raise ValueError("page must be at least 1")
    start = (page - 1) * per_page
    end = start + per_page
    return (start, end)
'''

PAGINATE_TEST = '''import unittest

from lane.paginate import page_bounds, page_count


class PageCountTest(unittest.TestCase):
    def test_exact_multiple(self):
        self.assertEqual(page_count(10, 5), 2)

    def test_partial_last_page(self):
        self.assertEqual(page_count(11, 5), 3)
        self.assertEqual(page_count(1, 5), 1)

    def test_no_items_means_no_pages(self):
        self.assertEqual(page_count(0, 5), 0)

    def test_invalid_arguments(self):
        with self.assertRaises(ValueError):
            page_count(10, 0)
        with self.assertRaises(ValueError):
            page_count(-1, 5)


class PageBoundsTest(unittest.TestCase):
    def test_full_page(self):
        self.assertEqual(page_bounds(11, 2, 5), (5, 10))

    def test_last_page_is_clipped_to_total(self):
        self.assertEqual(page_bounds(11, 3, 5), (10, 11))

    def test_empty_collection_has_one_empty_page(self):
        self.assertEqual(page_bounds(0, 1, 5), (0, 0))

    def test_page_past_the_end(self):
        with self.assertRaises(ValueError):
            page_bounds(11, 4, 5)
        with self.assertRaises(ValueError):
            page_bounds(0, 2, 5)

    def test_page_below_one(self):
        with self.assertRaises(ValueError):
            page_bounds(11, 0, 5)


if __name__ == "__main__":
    unittest.main()
'''

SLUG_BASE = '''def slugify(title: str, max_len: int = 40) -> str:
    return title.lower().replace(' ', '-')
'''

SLUG_TEST = '''import unittest

from lane.slug import slugify


class SlugifyTest(unittest.TestCase):
    def test_punctuation_is_dropped(self):
        self.assertEqual(slugify("Hello, World!"), "hello-world")

    def test_accents_are_folded_to_ascii(self):
        self.assertEqual(slugify("  Crème brûlée  "), "creme-brulee")

    def test_runs_of_other_characters_become_one_hyphen(self):
        self.assertEqual(slugify("a--b__c"), "a-b-c")

    def test_long_title_is_cut_at_a_word_boundary(self):
        self.assertEqual(slugify("The quick brown fox jumps", 12), "the-quick")

    def test_first_word_longer_than_limit_is_hard_cut(self):
        self.assertEqual(slugify("Supercalifragilistic", 5), "super")

    def test_nothing_left_is_untitled(self):
        self.assertEqual(slugify("!!!"), "untitled")
        self.assertEqual(slugify(""), "untitled")

    def test_short_title_is_kept_whole(self):
        self.assertEqual(slugify("The quick brown fox"), "the-quick-brown-fox")

    def test_max_len_below_one(self):
        for max_len in [0, -1]:
            with self.subTest(max_len=max_len):
                with self.assertRaises(ValueError):
                    slugify("title", max_len)


if __name__ == "__main__":
    unittest.main()
'''

REPORT_BASE = '''def summarize(rows: list, key: str) -> dict:
    raise NotImplementedError


def format_report(summary: dict, as_json: bool = False) -> str:
    raise NotImplementedError
'''

REPORT_TEST = '''import json
import unittest

from lane.report import format_report, summarize


class SummarizeTest(unittest.TestCase):
    def test_sums_amounts_per_key(self):
        rows = [{"amount": 1, "team": "x"}, {"amount": 2.5, "team": "x"}, {"amount": 4, "team": "y"}]
        self.assertEqual(summarize(rows, "team"), {"x": 3.5, "y": 4.0})

    def test_numeric_strings_are_amounts(self):
        rows = [{"amount": "3.25", "team": "y"}, {"amount": "1", "team": "y"}]
        self.assertEqual(summarize(rows, "team"), {"y": 4.25})

    def test_rows_without_the_field_go_to_none(self):
        rows = [{"amount": 4}, {"amount": 1, "team": "x"}, {"amount": "2"}]
        self.assertEqual(summarize(rows, "team"), {"(none)": 6.0, "x": 1.0})

    def test_non_numeric_amount(self):
        with self.assertRaises(ValueError):
            summarize([{"amount": "abc", "team": "x"}], "team")


class FormatReportTest(unittest.TestCase):
    def test_text_is_sorted_by_total_descending(self):
        self.assertEqual(format_report({"a": 1.0, "c": 7.5, "b": 3}),
                         "c: 7.50\\nb: 3.00\\na: 1.00\\ntotal: 11.50")

    def test_text_ties_are_sorted_by_key(self):
        self.assertEqual(format_report({"b": 5.0, "a": 5.0}), "a: 5.00\\nb: 5.00\\ntotal: 10.00")

    def test_empty_summary(self):
        self.assertEqual(format_report({}), "total: 0.00")

    def test_json_form(self):
        expected = json.dumps({"groups": {"a": 10.0, "b": 2.5}, "total": 12.5}, sort_keys=True)
        self.assertEqual(format_report({"b": 2.5, "a": 10.0}, as_json=True), expected)

    def test_json_totals_are_rounded_to_two_decimals(self):
        expected = json.dumps({"groups": {"x": 0.3}, "total": 0.3}, sort_keys=True)
        self.assertEqual(format_report({"x": 0.1 + 0.2}, as_json=True), expected)


if __name__ == "__main__":
    unittest.main()
'''

# id -> (spec prose, base module, test module). The module is lane/<id>.py.
TASKS = {
    'duration': (
        'Implement `parse_duration(text) -> int` in `lane/duration.py`: the number of seconds in a '
        'duration text. The text is one or more `<non-negative integer><unit>` groups with units '
        '`h`, `m`, `s`, each unit at most once and in that order; groups may be separated by single '
        'spaces; surrounding whitespace is ignored. `"90s"` gives 90, `"2m"` 120, `"1h30m"` 5400, '
        '`"1h 30m 15s"` 5415, `"0s"` 0, `" 45m "` 2700. `ValueError` for `""`, `"abc"`, `"5x"`, '
        '`"-3s"`, `"1m1h"`, `"1h1h"`, `"1.5h"`, `"h"`, `"10"`.',
        DURATION_BASE, DURATION_TEST),
    'paginate': (
        'Fix `lane/paginate.py`. `page_count(total, per_page)` is the number of pages, 0 for '
        '`total == 0`; `ValueError` when `per_page < 1` or `total < 0`. `page_bounds(total, page, '
        'per_page)` is the zero-based half-open slice `(start, end)` of the 1-based `page`, `end` '
        'clipped to `total`; `ValueError` when `page < 1` or `page > max(1, page_count(total, '
        'per_page))`. `page_count(10, 5)` is 2, `(11, 5)` is 3, `(0, 5)` is 0; `page_bounds(11, 3, '
        '5)` is `(10, 11)`, `(0, 1, 5)` is `(0, 0)`, `(11, 4, 5)` raises `ValueError`.',
        PAGINATE_BASE, PAGINATE_TEST),
    'slug': (
        'Implement `slugify(title, max_len=40) -> str` in `lane/slug.py`. NFKD-normalize and drop '
        'non-ASCII characters; lowercase; every run of characters outside `a-z0-9` becomes one '
        'hyphen; strip leading and trailing hyphens; when the result is longer than `max_len`, cut '
        'it at `max_len` and then drop a trailing partial word and hyphen, unless the first word '
        'alone is longer than `max_len` (then keep the hard cut); an empty result is `"untitled"`; '
        '`ValueError` when `max_len < 1`. `"Hello, World!"` gives `"hello-world"`, '
        '`"  Crème brûlée  "` gives `"creme-brulee"`, `"a--b__c"` gives `"a-b-c"`, '
        '`("The quick brown fox jumps", 12)` gives `"the-quick"`, `("Supercalifragilistic", 5)` '
        'gives `"super"`, `"!!!"` gives `"untitled"`.',
        SLUG_BASE, SLUG_TEST),
    'report': (
        'Implement `summarize(rows, key) -> dict` and `format_report(summary, as_json=False) -> str` '
        'in `lane/report.py`. `rows` is a list of dicts with an `"amount"` (int, float or numeric '
        'string) and optionally the field `key`; `summarize` maps each key value to the float sum of '
        'its amounts, rows without the field under `"(none)"`; `ValueError` on a non-numeric '
        'amount. The text form of `format_report` is one line per key, `"<key>: <total with two '
        'decimals>"`, sorted by total descending then key ascending, followed by `"total: <sum with '
        'two decimals>"`, lines joined with a newline; the JSON form is `json.dumps({"groups": '
        '{...totals rounded to two decimals...}, "total": <rounded sum>}, sort_keys=True)`.',
        REPORT_BASE, REPORT_TEST),
}


def must_run(task_id):
    return f'python3 -B -m unittest tests.test_{task_id}'


def module_path(task_id):
    return f'lane/{task_id}.py'


def fixture_files():
    """Relative path -> content of the fixture repository at the base."""
    files = {'.gitignore': GITIGNORE, 'README.md': README, 'lane/__init__.py': '',
             'tests/__init__.py': ''}
    for task_id, (_, base, test) in TASKS.items():
        files[module_path(task_id)] = base
        files[f'tests/test_{task_id}.py'] = test
    return files


def build_plan(executor, effort, supervisor, supervision, max_attempts):
    tasks = []
    for task_id in TASKS:
        task = {'id': task_id, 'branch': f'wave/{task_id}',
                'executor': {'model': executor, 'effort': effort}, 'ladder': [],
                'contract': {'files_allowed': [module_path(task_id)], 'files_forbidden': ['tests/**'],
                             'forbidden_moves': [], 'report_must_answer': [],
                             'must_run': [{'cmd': must_run(task_id), 'evidence': 'required'}]}}
        if supervision == 'mechanical':
            task['supervision'] = 'mechanical'
        else:
            task['contract']['forbidden_moves'] = ['weakening, deleting or skipping an existing test']
            task['contract']['report_must_answer'] = ['Which function changed and how?']
        tasks.append(task)
    wave = {'wave': 1, 'supervisor': {'model': supervisor, 'effort': 'high'},
            'limits': {'max_attempts': max_attempts, 'max_model_calls': 2 * max_attempts},
            'tasks': tasks}
    plan = {'waves': [wave], 'ci': 'none: disposable fixture has no CI',
            'e2e': 'not-applicable: four independent functions, no pipeline'}
    text = 'status: draft\nbase: pending\n\n```json wave-plan\n' + json.dumps(plan, indent=2) + '\n```\n'
    for task_id, (spec, _, _) in TASKS.items():
        text += f'\n## Task {task_id}\n\n{spec} Keep the tests unchanged.\n'
    return text


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b''):
            digest.update(chunk)
    return digest.hexdigest()


def hash_tree(root):
    hashes = {}
    for directory, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d != '__pycache__')
        for name in sorted(names):
            if name.endswith('.pyc'):
                continue
            path = Path(directory) / name
            hashes[path.relative_to(root).as_posix()] = sha256(path)
    return hashes


def run(cmd, cwd=None, env=None, timeout=None, stdin=subprocess.DEVNULL):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout, stdin=stdin)


def git(repo, *args):
    result = run(['git', '-C', str(repo), *args])
    if result.returncode != 0:
        raise RuntimeError(f'git {" ".join(args)} failed in {repo}: {result.stderr.strip()}')
    return result.stdout.strip()


def die(message, code):
    print(message, file=sys.stderr)
    sys.exit(code)


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def create_fixture(out):
    repo, origin = out / 'repo', out / 'origin.git'
    repo.mkdir()
    git(repo, 'init', '-q', '-b', 'main')
    for key, value in [('user.name', 'Lane Fixture'), ('user.email', 'lane@example.invalid'),
                       ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
        git(repo, 'config', key, value)
    for relative, content in fixture_files().items():
        target = repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'Fixture base')
    run(['git', 'init', '-q', '--bare', str(origin)])
    git(repo, 'remote', 'add', 'origin', str(origin))
    git(repo, 'push', '-q', 'origin', 'main')
    return repo, git(repo, 'rev-parse', 'HEAD')


def write_wrapper(path, real):
    path.write_text(f'#!/bin/sh\nexec {shlex.quote(shutil.which(real) or real)} "$@" --setting-sources \'\'\n')
    path.chmod(0o755)


def tail(text, limit=2000):
    return text[-limit:]


def child_cost(child):
    try:
        cost = json.loads(Path(child['result']).read_text()).get('total_cost_usd')
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
    return cost if isinstance(cost, (int, float)) and not isinstance(cost, bool) else None


def independent_check(repo, out, base, task_id, command, timeout):
    """Re-check a task outside the runner: must_run in a fresh worktree, and the diff paths."""
    branch = f'wave/{task_id}'
    green = False
    parent = out / 'check'
    checkout = parent / task_id
    parent.mkdir(exist_ok=True)
    if run(['git', '-C', str(repo), 'worktree', 'add', '--detach', str(checkout), branch]).returncode == 0:
        try:
            green = subprocess.run(command, shell=True, cwd=checkout, capture_output=True, timeout=timeout,
                                   stdin=subprocess.DEVNULL).returncode == 0
        except subprocess.TimeoutExpired:
            green = False
        finally:
            run(['git', '-C', str(repo), 'worktree', 'remove', '--force', str(checkout)])
            shutil.rmtree(checkout, ignore_errors=True)
    try:
        parent.rmdir()
    except OSError:
        pass
    diff = run(['git', '-C', str(repo), 'diff', '--name-only', f'{base}..{branch}'])
    paths_ok = diff.returncode == 0 and diff.stdout.split() == [module_path(task_id)]
    return green, paths_ok


def parse_args(argv):
    parser = argparse.ArgumentParser(description='Run one wave of four small closed tasks through the '
                                     'candidate native Claude runner and record what happened.')
    parser.add_argument('--executor', required=True, help='Claude model id for the four tasks')
    parser.add_argument('--out', required=True, help='new or empty result directory')
    parser.add_argument('--effort', default='medium')
    parser.add_argument('--supervisor', default='claude-opus-5-5')
    parser.add_argument('--supervision', choices=['mechanical', 'model'], default='mechanical')
    parser.add_argument('--max-attempts', type=int, default=2)
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--timeout-min', type=int, default=20)
    parser.add_argument('--claude', default='claude', help='Claude CLI executable (default: claude)')
    parser.add_argument('--user-settings', action='store_true',
                        help='let the CLI load user settings, hooks and installed plugins')
    parser.add_argument('--prepare-only', action='store_true',
                        help='write the fixture, plan and expectations; make no model call')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    out = Path(args.out).resolve()
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        die(f'--out exists and is not empty: {out}', 73)
    out.mkdir(parents=True, exist_ok=True)

    # 2. Snapshot the candidate; every later step uses it, never the working tree.
    package = out / 'package' / PLUGIN
    shutil.copytree(REPO_ROOT / PLUGIN, package, ignore=shutil.ignore_patterns(*IGNORE))
    snapshot = hash_tree(package)
    write_json(out / 'snapshot.json', snapshot)
    try:
        version = run([args.claude, '--version'])
    except OSError as error:
        version = subprocess.CompletedProcess([], 127, '', str(error))
    plugin = json.loads((package / '.claude-plugin' / 'plugin.json').read_text())
    write_json(out / 'meta.json', {
        'plugin_version': plugin.get('version'),
        'git_head': git(REPO_ROOT, 'rev-parse', 'HEAD'),
        'dirty': git(REPO_ROOT, 'status', '--porcelain') != '',
        'executor': args.executor, 'effort': args.effort, 'supervisor': args.supervisor,
        'supervision': args.supervision, 'max_attempts': args.max_attempts,
        'user_settings': args.user_settings,
        'cli_version': version.stdout.strip() if version.returncode == 0 else f'unavailable: {tail(version.stderr).strip()}',
        'started_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    })

    # 3. Fixture repository with a bare origin.
    repo, base = create_fixture(out)

    # 4. Plan, linted by the snapshot's linter.
    plan = out / 'plan.md'
    plan.write_text(build_plan(args.executor, args.effort, args.supervisor, args.supervision, args.max_attempts))
    lint = run(['node', str(package / 'skills/super-plan/references/plan-lint.mjs'), str(plan), '--repo', str(repo)])
    if lint.returncode != 0:
        (out / 'lint.log').write_text(lint.stdout + lint.stderr)
        die(f'plan lint failed (exit {lint.returncode}); see {out / "lint.log"}', 65)

    # 5. Freeze expectations; each task must be red at the base.
    tasks = {}
    for task_id in TASKS:
        command = must_run(task_id)
        red = subprocess.run(command, shell=True, cwd=repo, capture_output=True,
                             stdin=subprocess.DEVNULL).returncode != 0
        if not red:
            die(f'fixture defect: {command} is green at the base', 70)
        tasks[task_id] = {'module': module_path(task_id), 'must_run': command, 'base_red': True}
    write_json(out / 'expected.json', {'base': base, 'tasks': tasks})
    if args.prepare_only:
        return 0

    # 6. Run the snapshot's runner.
    claude = args.claude
    if not args.user_settings:
        claude = out / 'claude-wrapper.sh'
        write_wrapper(claude, args.claude)
    env = {key: value for key, value in os.environ.items() if key != 'CLAUDECODE'}
    started = time.monotonic()
    runner = run(['node', str(package / 'skills/multi-model/references/claude-wave-runner.mjs'),
                  '--plan', str(plan), '--wave', '1', '--repo', str(repo), '--base', base,
                  '--default-branch', 'main', '--jobs', str(args.jobs), '--timeout-min', str(args.timeout_min),
                  '--out', str(out / 'run'), '--claude', str(claude)], env=env)
    wall = time.monotonic() - started
    (out / 'runner.stdout').write_text(runner.stdout)
    (out / 'runner.stderr').write_text(runner.stderr)
    write_json(out / 'runner.json', {'exit': runner.returncode, 'wall_seconds': wall})

    # 7. Outcomes.
    try:
        summary = json.loads((out / 'run' / 'summary.json').read_text())
        statuses = {task['id']: task['status'] for task in summary['tasks']}
        children = summary['children']
        wave_status, usage = summary['status'], summary['usage']
    except (OSError, ValueError, KeyError, TypeError) as error:
        die(f'blocked: the runner produced no readable summary (exit {runner.returncode}): {error}; '
            f'see {out / "runner.stderr"}', 1)
    unchanged = hash_tree(package) == snapshot
    costs = [child_cost(child) for child in children]
    result_tasks = {}
    for task_id, expected in tasks.items():
        own = [child for child in children if child.get('task') == task_id]
        status = statuses.get(task_id, 'missing')
        executor_calls = sum(1 for child in own if child.get('role') == 'exec')
        green, paths_ok = independent_check(repo, out, base, task_id, expected['must_run'], args.timeout_min * 60)
        result_tasks[task_id] = {'status': status, 'executor_calls': executor_calls,
                                 'judge_calls': sum(1 for child in own if child.get('role') == 'judge'),
                                 'first_attempt_ok': status == 'ok' and executor_calls == 1,
                                 'independent_green': green, 'paths_ok': paths_ok}
    ok = sum(1 for t in result_tasks.values() if t['status'] == 'ok' and t['independent_green'] and t['paths_ok'])
    write_json(out / 'outcomes.json', {
        'executor': args.executor, 'effort': args.effort, 'supervisor': args.supervisor,
        'supervision': args.supervision, 'wall_seconds': wall, 'runner_exit': runner.returncode,
        'status': wave_status, 'snapshot_unchanged': unchanged, 'usage': usage,
        'reported_cost_usd': None if any(cost is None for cost in costs) else sum(costs),
        'tasks': result_tasks,
        'totals': {'ok': ok, 'first_attempt_ok': sum(1 for t in result_tasks.values() if t['first_attempt_ok']),
                   'failed': len(result_tasks) - ok},
    })

    # 8. A failed task is a measurement; a changed snapshot is a blocked run.
    if not unchanged:
        die('blocked: the snapshot changed during the run', 1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
