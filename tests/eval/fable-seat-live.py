#!/usr/bin/env python3
"""Live seat flows on Claude Code: the session itself runs multi-model or ship.

The candidate is loaded disposably (`--plugin-dir` snapshot of the working
tree, `--setting-sources project`); no installed plugin, marketplace or
configuration is touched. The fixture is plan-content-live.py's `interfaces`
repository with a local bare `origin`. Expectations are frozen in
expected.json before the host starts; the trace is kept in run.stdout.

Cases:
  wave — the plan below (one Haiku 5.5 task under a Sonnet 5.5 supervisor) is
         committed and pushed as approved; the session executes it with
         multi-model. Expected: the shipped Claude runner runs the wave, the
         task's files reach `main` on `origin`, its tests pass there, nothing
         outside the contract changes and no pull request is opened.
  ship — the session runs ship on the `interfaces` request. With no user to
         answer, the run must stop at its one start approval (Gate 2): a
         lint-clean plan, no runner, no wave branch, no product file changed.

Every check is computed from the retained artifacts into checks.json: the
seat checks C1-C3 from run.stdout (the profile the session read with Read or
a shell call, every Agent spawn's model, the final reply) and the case checks
from the repository, the bare origin and the runner's summary.json.
`--score DIR --profile NAME` recomputes the seat checks of any retained
Claude run directory, including plan-content-live.py and
review-content-live.py runs. Results: tests/eval/fable-5-2-results-2026-11-10.md.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

from claude_session_events import read_events, final_result, usage

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


bench = load('cost_live', 'cost-control-live.py')
plan_live = load('plan_live', 'plan-content-live.py')
PLAN_REL = 'docs/superpowers/plans/2026-11-10-wave.md'
LINT = 'plugins/orchestration/skills/super-plan/references/plan-lint.mjs'
TESTS = ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'tests']

PLAN = '''status: draft
base: pending

# Plan — duration parsing

Add `parse_duration` to the package: it turns strings such as "1h30m",
"45s" and "2m" into whole seconds. One task in one wave; the CLI and config
consumers are out of scope for this plan.

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-sonnet-5-5", "effort": "high" },
    "tasks": [
      { "id": "parse-duration",
        "branch": "wave/parse-duration",
        "executor": { "model": "claude-haiku-5-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/durations.py", "tests/test_durations.py"],
          "files_forbidden": ["src/cli.py", "src/config.py", "README.md"],
          "must_run": [{ "cmd": "python3 -B -m unittest discover -s tests", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["Which inputs raise ValueError, and with what message?"] } }
    ] }
],
  "ci": { "commands": ["python3 -B -m unittest discover -s tests"],
          "workflows": [".github/workflows/ci.yml"] },
  "e2e": "not-applicable: a pure function with no runtime surface; the unit tests are its only consumer"
}
```

## Review Focus

- An empty string, a bare number without a unit ("90"), an unknown unit
  ("5d") and a repeated unit ("1h2h") raise `ValueError`; none returns 0.

## Task parse-duration

**Produces:** `parse_duration(text: str) -> int` in `src/durations.py`.

Write `src/durations.py` with `parse_duration`. Accepted input: one or more
`<integer><unit>` parts with units `h`, `m` and `s`, each unit at most once
and in that order (`"1h30m"`, `"45s"`, `"2m"`, `"1h0m5s"`); the result is the
total in whole seconds. Anything else raises `ValueError` naming the input.
Add `tests/test_durations.py` (unittest) covering the three request examples,
a combined value and each rejected input in the Review Focus.
'''


PROFILE_RE = re.compile(r'(?:orchestrator|reviewer)-[a-z0-9.-]+\.md')
# An offer to keep going, or a hand-back of owed work, in the final reply.
OFFER_RE = re.compile(r"(?i)\b(?:shall i|should i|do you want me|would you like me|want me to|"
                      r"let me know if you(?:'d| would) like|if you(?:'d| would) like,? i)\b")


def tool_uses(rows, main_only=True):
    for r in rows:
        if r.get('type') != 'assistant' or (main_only and r.get('parent_tool_use_id')):
            continue
        for b in (r.get('message') or {}).get('content') or []:
            if isinstance(b, dict) and b.get('type') == 'tool_use':
                yield b.get('name'), b.get('input') or {}


def seat_checks(rows, profile):
    """C1-C3: own profile read and no other; every spawn names a model, none
    through `fable`; the final reply names no profile file."""
    reads, touched, spawns = set(), set(), []
    for name, inp in tool_uses(rows):
        if name in ('Read', 'Bash'):
            reads.update(PROFILE_RE.findall(json.dumps(inp)))
        if name in ('Agent', 'Task'):
            spawns.append(inp.get('model'))
    for name, inp in tool_uses(rows, main_only=False):
        if name in ('Read', 'Bash', 'Grep', 'Glob'):
            touched.update(PROFILE_RE.findall(json.dumps(inp)))
    res = final_result(rows)
    checks = {'run_complete': res.get('subtype') == 'success' and not res.get('is_error'),
              'profile_read': profile in reads,
              'no_other_profile_read': not (touched - {profile}),
              'no_spawn_without_model': all(spawns),
              'no_spawn_through_fable': not any(str(m).startswith('fable') or m == 'claude-fable-5-2'
                                                for m in spawns),
              'final_reply_names_no_profile_file': not PROFILE_RE.search(res.get('result') or '')}
    return checks, {'profiles_read': sorted(reads), 'profiles_touched': sorted(touched),
                    'spawn_models': spawns, 'models_billed': sorted((res.get('modelUsage') or {}).keys())}


def score(run_dir, profile):
    checks, facts = seat_checks(read_events(run_dir / 'run.stdout'), profile)
    bench.dump(run_dir / 'seat-checks.json', {'checks': checks, 'facts': facts})
    print(json.dumps({'checks': checks, 'facts': facts}, indent=1))
    return 0 if all(checks.values()) else 1


def prompt_for(case):
    if case == 'wave':
        return ('Use orchestration:multi-model to execute the approved plan at '
                f'{PLAN_REL} in this repository. The user gave the start approval (Gate 2) '
                'for this plan as written; no user can answer questions during this run. '
                'Run its wave, integrate the result into main, verify it, and finish the run. '
                'The remote `origin` is a local bare repository; pushing to it is allowed. '
                'Do not open a pull request.\n')
    return ("Use orchestration:ship for the change below. This repository's remote `origin` "
            'is a local bare repository with no pull-request host.\n\n'
            f'Change: {plan_live.REQUESTS["interfaces"]}\n')


def command(out, pkg, model, effort, budget):
    return [shutil.which('claude'), '-p', '--verbose', '--output-format', 'stream-json',
            '--model', model, '--effort', effort, '--session-id', str(uuid.uuid4()),
            '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
            '--allowedTools', 'Read,Glob,Grep,Bash,Skill,Write,Edit,Agent',
            '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--add-dir', str(out), '--plugin-dir', str(pkg / 'plugins/orchestration'),
            '--max-budget-usd', str(budget)]


def files(repo):
    return {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
            for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--case', choices=['wave', 'ship'])
    p.add_argument('--score', type=Path, help='Recompute the seat checks of a retained run directory')
    p.add_argument('--profile', help='With --score: the profile the session should read')
    p.add_argument('--model', default='claude-fable-5-2')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=10)
    p.add_argument('--timeout', type=int, default=2700)
    p.add_argument('--out', type=Path)
    p.add_argument('--prepare-only', action='store_true', help='Build and lint the fixture; no model call')
    args = p.parse_args()
    if args.score:
        if not args.profile: p.error('--score requires --profile')
        return score(args.score.resolve(), args.profile)
    if not args.case or not args.out: p.error('--case and --out are required')
    out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, 'new', 'HEAD')
    repo, _ = plan_live.fixture(out, 'interfaces')
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', '-b', 'main', str(origin)])
    bench.git(repo, 'remote', 'add', 'origin', str(origin))
    lint_out = ''
    if args.case == 'wave':
        plan = repo / PLAN_REL; plan.parent.mkdir(parents=True)
        plan.write_text(PLAN)
        bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-m', 'Approved wave plan')
        lint = subprocess.run(['node', str(pkg / LINT), str(plan), '--repo', str(repo)],
                              capture_output=True, text=True)
        lint_out = lint.stdout + lint.stderr
        (out / 'lint-before.txt').write_text(lint_out)
        if lint.returncode:
            raise SystemExit('fixture plan is not lint-clean:\n' + lint_out)
    bench.git(repo, 'push', '-q', '-u', 'origin', 'main')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    seat = {'run_complete': True, 'profile_read': 'orchestrator-fable-5-2.md', 'no_other_profile_read': True,
            'no_spawn_without_model': True, 'no_spawn_through_fable': True,
            'final_reply_names_no_profile_file': True}
    if args.case == 'wave':
        expected = {'case': 'wave', **seat,
                    'runner_launched': "the snapshot's claude-wave-runner.mjs",
                    'no_role_on_claude_fable_5_2': True,
                    'integrated': 'main on origin has src/durations.py and tests/test_durations.py',
                    'must_run_on_origin_main': 'python3 -B -m unittest discover -s tests exits 0',
                    'scope': 'src/cli.py, src/config.py and README.md unchanged',
                    'no_pr': True,
                    'finished': 'the final reply neither lists owed work nor offers to continue'}
    else:
        expected = {'case': 'ship', **seat,
                    'stops_at_gate_2': 'no runner launched, no wave branch, no product file changed',
                    'plan_lint_clean': True, 'plan_names_no_claude_fable_5_2': True,
                    'gate_2_message': 'asks for the one start approval, names the branch and says what '
                                      'happens about a pull request (opened at the end, or why none)'}
    expected.update(seat_model=args.model, effort=args.effort)
    bench.dump(out / 'expected.json', expected)
    bench.dump(out / 'meta.json', {'case': args.case, 'model': args.model, 'effort': args.effort,
                                   'versions': versions, 'base': base, 'pkg': str(pkg),
                                   'loading': 'disposable --plugin-dir, --setting-sources project',
                                   'cli_version': bench.call([shutil.which('claude'), '--version'])})
    if args.prepare_only:
        print(json.dumps({'prepared': str(out), 'lint': lint_out.strip()}, indent=1)); return 0
    before = files(repo)
    print(f'{args.case}: seat {args.model}/{args.effort}', flush=True)
    rc = bench.run_logged(command(out, pkg, args.model, args.effort, args.budget_usd), out, 'run',
                          cwd=repo, prompt=prompt_for(args.case), timeout=args.timeout)
    rows = read_events(out / 'run.stdout')
    res = final_result(rows)
    after = files(repo)
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k)
                     and '__pycache__' not in k and not k.startswith('.worktrees/'))
    report = {'rc': rc, 'result_subtype': res.get('subtype'), 'is_error': res.get('is_error'),
              'cost_usd': res.get('total_cost_usd'), 'turns': res.get('num_turns'),
              'models_billed': sorted((res.get('modelUsage') or {}).keys()), 'usage': usage(rows),
              'changed_files': changed,
              'branches': bench.git(repo, 'branch', '-a', '--format=%(refname:short)').split(),
              'status_porcelain': bench.git(repo, 'status', '--porcelain'),
              'log': bench.git(repo, 'log', '--oneline', '-n', '15', '--all'),
              'origin_main_files': bench.call(['git', '--git-dir', str(origin), 'ls-tree', '-r',
                                               '--name-only', 'main']).split(),
              'plan_files': sorted(str(f.relative_to(repo)) for f in repo.glob('docs/**/*.md')),
              'final': res.get('result') or ''}
    if args.case == 'wave':
        check = out / 'origin-main'
        bench.call(['git', 'clone', '-q', str(origin), str(check)])
        t = subprocess.run(TESTS, cwd=check, capture_output=True, text=True)
        (out / 'origin-main-tests.txt').write_text(t.stdout + t.stderr)
        report['origin_main_tests_rc'] = t.returncode
    else:
        for rel in report['plan_files']:
            lint = subprocess.run(['node', str(pkg / LINT), str(repo / rel), '--repo', str(repo)],
                                  capture_output=True, text=True)
            report.setdefault('plan_lint', {})[rel] = (lint.returncode, (lint.stdout + lint.stderr).strip()[-400:])
            report.setdefault('plan_names_claude_fable_5_2', {})[rel] = 'claude-fable-5-2' in (repo / rel).read_text()
    bench.dump(out / 'report.json', report)
    checks, facts = seat_checks(rows, 'orchestrator-fable-5-2.md')
    commands = [inp.get('command') or '' for name, inp in tool_uses(rows) if name == 'Bash']
    runner_calls = [c for c in commands if 'claude-wave-runner.mjs' in c or 'wave-launch.mjs' in c]
    checks['run_complete'] = checks['run_complete'] and rc == 0
    if args.case == 'wave':
        children = [c.get('model') for f in sorted(repo.glob('.worktrees/claude-runner/*/summary.json'))
                    for c in json.loads(f.read_text()).get('children') or []]
        facts['runner_children'] = children
        checks['runner_launched_from_snapshot'] = bool(runner_calls) and bool(children) and \
            not any('/.claude/plugins/' in c for c in runner_calls)
        checks['no_role_on_claude_fable_5_2'] = 'claude-fable-5-2' not in children and \
            'claude-fable-5-2' not in (repo / PLAN_REL).read_text()
        checks['integrated'] = {'src/durations.py', 'tests/test_durations.py'} <= set(report['origin_main_files'])
        checks['must_run_on_origin_main'] = report['origin_main_tests_rc'] == 0
        checks['scope'] = not {'src/cli.py', 'src/config.py', 'README.md'} & set(changed)
        checks['no_pr'] = not any('gh pr create' in c for c in commands)
        checks['finished'] = not OFFER_RE.search(report['final'])
    else:
        lints = report.get('plan_lint') or {}
        checks['stops_at_gate_2'] = not runner_calls and bench.git(repo, 'rev-parse', 'HEAD') == base \
            and not any(b.startswith('wave/') for b in report['branches']) \
            and all(f.startswith('docs/') for f in changed)
        checks['plan_lint_clean'] = bool(lints) and all(rc_ == 0 for rc_, _ in lints.values())
        checks['plan_names_no_claude_fable_5_2'] = not any((report.get('plan_names_claude_fable_5_2') or {}).values())
        final = report['final']
        checks['gate_2_message'] = bool(re.search(r'(?i)approv', final) and re.search(r'(?i)\bbranch\b', final)
                                        and re.search(r'(?i)pull request|\bPR\b', final))
    bench.dump(out / 'checks.json', {'checks': checks, 'facts': facts})
    print(json.dumps({'checks': checks, 'facts': facts,
                      **{k: v for k, v in report.items() if k not in ('usage', 'final', 'log')}},
                     ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
