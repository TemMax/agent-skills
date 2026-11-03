#!/usr/bin/env python3
"""Live check of super-plan's plan-content rules (synced from superpowers v7.0.1).

One headless planning run on a real host CLI and a real model, against a fresh
disposable repository, with the candidate (`--arm new`, the working tree) or a
git ref (`--arm old`) loaded disposably: Claude through `--plugin-dir`, Codex
through workspace skills with user plugins disabled. No installed plugin,
marketplace or configuration is touched. Expectations are frozen in
expected.json before the run; metrics.json records what came out.

Cases:
  interfaces — one producer (`parse_duration`) and three consumers. The plan
               should record decisions rather than code, carry Consumes/Produces
               blocks when producer and consumer are separate tasks, and a
               `## Review Focus` above the first task.
  platform   — an idea-stage repository and a request that leaves the platform
               open. The headless plan should record the platform question under
               `## Assumptions (would ask)` instead of picking one silently.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import uuid

from claude_session_events import read_events, final_result, usage

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cost_live', Path(__file__).with_name('cost-control-live.py'))
bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)

LINT = 'plugins/orchestration/skills/super-plan/references/plan-lint.mjs'
NEW_MARK = 'unambiguous, not complete'
OLD_MARK = 'with full code where the solution'

REQUESTS = {
    'interfaces': (
        'Add duration parsing to this package. A new function in src/durations.py '
        'parses strings such as "1h30m", "45s" and "2m" into whole seconds. Three '
        'places use it: a CLI command `wait <duration>` in src/cli.py that prints '
        'the seconds, a `load_timeout(config: dict) -> int` in src/config.py that '
        'reads config["timeout"] as a duration string, and README.md, which '
        'documents the accepted format.'),
    'platform': (
        'Build a habit tracker: people add habits, check them off each day and see '
        'their current streak.'),
}


def fixture(out, case):
    repo = out / 'repo'
    (repo / 'src').mkdir(parents=True)
    (repo / '.gitignore').write_text('.worktrees/\n__pycache__/\n*.pyc\n')
    if case == 'interfaces':
        (repo / 'tests').mkdir()
        (repo / 'src/__init__.py').write_text('')
        (repo / 'tests/__init__.py').write_text('')
        (repo / 'src/cli.py').write_text(
            'import sys\n\n\ndef main(argv=None):\n    argv = sys.argv[1:] if argv is None else argv\n'
            '    if argv[:1] == ["version"]:\n        print("0.1.0")\n        return 0\n'
            '    print("unknown command", file=sys.stderr)\n    return 2\n')
        (repo / 'src/config.py').write_text('def load_name(config: dict) -> str:\n    return str(config.get("name", "app"))\n')
        (repo / 'tests/test_cli.py').write_text(
            'import unittest\nfrom src.cli import main\n\n\nclass Tests(unittest.TestCase):\n'
            '    def test_version(self):\n        self.assertEqual(main(["version"]), 0)\n')
        (repo / 'tests/test_config.py').write_text(
            'import unittest\nfrom src.config import load_name\n\n\nclass Tests(unittest.TestCase):\n'
            '    def test_name(self):\n        self.assertEqual(load_name({}), "app")\n')
        (repo / 'README.md').write_text('# Fixture\n\nA small command-line package.\n')
        (repo / '.github/workflows').mkdir(parents=True)
        (repo / '.github/workflows/ci.yml').write_text(
            'name: ci\non: [pull_request]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n'
            '    steps:\n      - uses: actions/checkout@v4\n      - run: python3 -B -m unittest discover -s tests\n')
    else:
        (repo / 'README.md').write_text('# Habits\n\nIdea stage: nothing is built yet.\n')
        (repo / 'src/.keep').write_text('')
    (repo / 'AGENTS.md').write_text('Read README.md before changing the repository. Do not create a PR.\n')
    bench.git(repo, 'init', '-b', 'main')
    for k, v in [('user.name', 'Live fixture'), ('user.email', 'fixture@example.invalid'),
                 ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
        bench.git(repo, 'config', k, v)
    bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-m', 'Frozen fixture')
    return repo, bench.git(repo, 'rev-parse', 'HEAD')


def register(repo, pkg):
    registry = repo / '.agents/skills'; registry.mkdir(parents=True, exist_ok=True)
    for name in ['multi-model', 'super-plan']:
        (registry / name).symlink_to(pkg / 'plugins/orchestration/skills-codex' / name, target_is_directory=True)


def prompt_for(case, provider, plan_rel):
    skill = 'orchestration:super-plan' if provider == 'claude' else '$super-plan'
    return (f'Use {skill} to plan the change below. EVAL MODE: no user can answer — apply the '
            f"skill's headless evaluation mode. Write the plan to {plan_rel} in this repository, "
            "run the skill's Lint step on it and fix every error. Do not implement anything and do "
            'not change any other file. When the plan is lint-clean, reply with its path only.\n\n'
            f'Change: {REQUESTS[case]}\n')


def command(provider, repo, out, pkg, model, effort, budget):
    if provider == 'claude':
        return [shutil.which('claude'), '-p', '--verbose', '--output-format', 'stream-json',
                '--model', model, '--effort', effort, '--session-id', str(uuid.uuid4()),
                '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
                '--allowedTools', 'Read,Glob,Grep,Bash,Skill,Write,Edit,Agent',
                '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                '--add-dir', str(out), '--plugin-dir', str(pkg / 'plugins/orchestration'),
                '--max-budget-usd', str(budget)]
    register(repo, pkg)
    return [shutil.which('codex'), 'exec', '--ignore-user-config', '--disable', 'plugins', '--json',
            '--skip-git-repo-check', '--model', model, '-c', f'model_reasoning_effort="{effort}"',
            '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
            '-C', str(repo), '--sandbox', 'workspace-write', '--add-dir', str(out), '-']


def sections(text):
    """Level-1/2 headings outside fences → list of (heading, body lines)."""
    out, fence, cur = [], None, ('', [])
    for line in text.split('\n'):
        m = re.match(r'^\s*(`{3,}|~{3,})', line)
        if fence is None and re.match(r'^#{1,2} ', line):
            out.append(cur); cur = (line.strip(), []); continue
        if m:
            if fence is None: fence = m.group(1)
            elif line.strip() == m.group(1) or line.strip().startswith(fence): fence = None
        cur[1].append(line)
    out.append(cur)
    return out


def code_share(lines):
    fence, code, total = None, 0, 0
    for line in lines:
        m = re.match(r'^\s*(`{3,}|~{3,})', line)
        if fence is None and m: fence = m.group(1); total += bool(line.strip()); continue
        if fence is not None and m and line.strip() == m.group(1): fence = None; total += 1; continue
        if line.strip():
            total += 1; code += fence is not None
    return code, total


def analyze(case, plan_text, lint_out):
    secs = sections(plan_text)
    tasks = [(h, b) for h, b in secs if re.match(r'^## Task [a-z0-9-]+$', h)]
    first_task = next((i for i, (h, _) in enumerate(secs) if re.match(r'^## Task ', h)), len(secs))
    focus = [(i, b) for i, (h, b) in enumerate(secs) if h == '## Review Focus']
    code = total = 0
    for _, body in tasks:
        c, t = code_share(body); code += c; total += t
    joined = {h: '\n'.join(b) for h, b in tasks}
    def block(body, label, other):
        """Text after `label:` up to the other label, a blank line or the next bold label."""
        return ' '.join(m.group(1) for m in re.finditer(
            label + r':(.*?)(?=' + other + r':|\n\s*\n|\n\*\*|\Z)', body, re.S))
    producers = [h for h, b in joined.items() if 'parse_duration' in block(b, 'Produces', 'Consumes')]
    consumers = [h for h, b in joined.items() if 'parse_duration' in block(b, 'Consumes', 'Produces')]
    # Every task other than a producer that uses parse_duration must say so in Consumes.
    users = [h for h, b in joined.items() if 'parse_duration' in b and h not in producers]
    missing_consumes = [h for h in users if h not in consumers]
    focus_body = '\n'.join(focus[0][1]).strip() if focus else ''
    assumptions = '\n'.join(next((b for h, b in secs if h.startswith('## Assumptions')), []))
    return {
        'tasks': len(tasks), 'plan_lines': len(plan_text.splitlines()), 'plan_chars': len(plan_text),
        'task_code_lines': code, 'task_lines': total, 'task_code_share': round(code / total, 3) if total else None,
        'review_focus_present': bool(focus), 'review_focus_above_first_task': bool(focus) and focus[0][0] < first_task,
        'review_focus_items': len(re.findall(r'(?m)^\s*(?:[-*]|\d+\.)\s+\S', focus_body)),
        'review_focus_none_found': 'none found' in focus_body.lower(),
        'producer_tasks': producers, 'consumer_tasks': consumers,
        'users_without_consumes': missing_consumes,
        'assumptions_mention_platform': bool(re.search(r'(?i)\bplatform\b|\bios\b|android|mobile|desktop|web app|browser', assumptions)),
        'lint_ok': bool(re.search(r'(?m)^OK: 0 error', lint_out)),
        'lint_warnings': re.findall(r'(?m)^warn: (\S+):', lint_out),
    }


def loaded(trace_text, mark):
    """The arm's own WORKFLOW.md was read: its path and its arm-only phrase appear in
    the trace. Installed plugins are disabled, so only the snapshot carries the text."""
    return 'super-plan/WORKFLOW.md' in trace_text and mark in trace_text


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', required=True, choices=['claude', 'codex'])
    p.add_argument('--case', required=True, choices=sorted(REQUESTS))
    p.add_argument('--arm', default='new', choices=['new', 'old'])
    p.add_argument('--old-ref', default='HEAD')
    p.add_argument('--model')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=6)
    p.add_argument('--timeout', type=int, default=1200)
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args(); out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    model = args.model or ('claude-opus-5-5' if args.provider == 'claude' else 'gpt-6.1-sol')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, args.arm, args.old_ref)
    repo, base = fixture(out, args.case)
    plan_rel = 'docs/superpowers/plans/2026-11-02-live.md'
    mark = NEW_MARK if args.arm == 'new' else OLD_MARK
    workflow = pkg / 'plugins/orchestration' / ('skills' if args.provider == 'claude' else 'skills-codex') / 'super-plan/WORKFLOW.md'
    if mark not in workflow.read_text(): raise SystemExit(f'snapshot lacks its arm marker: {mark!r}')
    expected = {'case': args.case, 'arm': args.arm, 'plan_written': True, 'lint_ok': True,
                'workflow_loaded_from_snapshot': True, 'no_other_product_file_changed': True}
    if args.arm == 'new':
        expected['no_new_lint_warnings'] = ['review-focus', 'proportion', 'section-order']
        if args.case == 'interfaces':
            expected.update(review_focus_above_first_task=True, review_focus_has_items=True,
                            task_code_share_at_most=0.5,
                            producer_has_produces='exactly one task has Produces: parse_duration',
                            every_user_has_consumes='every other task naming parse_duration has it under Consumes:')
        else:
            expected.update(assumptions_mention_platform=True)
    bench.dump(out / 'expected.json', expected)
    before = {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts}
    cmd = command(args.provider, repo, out, pkg, model, args.effort, args.budget_usd)
    bench.dump(out / 'meta.json', {'provider': args.provider, 'case': args.case, 'arm': args.arm,
        'old_ref': args.old_ref if args.arm == 'old' else None, 'model': model, 'effort': args.effort,
        'versions': versions, 'base': base, 'workflow': str(workflow),
        'loading': 'disposable --plugin-dir' if args.provider == 'claude' else 'workspace skills, user config and plugins disabled',
        'cli_version': bench.call([shutil.which(args.provider), '--version'])})
    print(f'{args.provider}/{args.case}/{args.arm}: planning with {model}', flush=True)
    rc = bench.run_logged(cmd, out, 'run', cwd=repo, prompt=prompt_for(args.case, args.provider, plan_rel), timeout=args.timeout)
    trace = (out / 'run.stdout').read_text(errors='replace')
    rows = read_events(out / 'run.stdout')
    if args.provider == 'claude':
        res = final_result(rows)
        spend = {'usd': res.get('total_cost_usd'), 'usage': usage(rows), 'turns': res.get('num_turns')}
        complete = res.get('subtype') == 'success' and not res.get('is_error')
    else:
        done = [r for r in rows if r.get('type') == 'turn.completed']
        spend = {'usage': done[-1].get('usage') if done else None}
        complete = bool(done)
    plan = repo / plan_rel
    plan_text = plan.read_text() if plan.exists() else ''
    if plan.exists():
        shutil.copyfile(plan, out / 'plan.md')
        lint = bench.subprocess.run(['node', str(ROOT / LINT), str(plan), '--repo', str(repo)], capture_output=True, text=True)
        lint_out = lint.stdout + lint.stderr
    else:
        lint_out = ''
    (out / 'lint.txt').write_text(lint_out)
    after = {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
             for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts and '.agents' not in f.parts}
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k != plan_rel
                     and not k.startswith('.agents/') and '__pycache__' not in k)
    metrics = analyze(args.case, plan_text, lint_out)
    checks = {'run_complete': rc == 0 and complete, 'plan_written': bool(plan_text),
              'lint_ok': metrics['lint_ok'],
              'workflow_loaded_from_snapshot': loaded(trace, mark),
              'no_other_product_file_changed': not changed}
    if args.arm == 'new':
        checks['no_new_lint_warnings'] = not set(metrics['lint_warnings']) & {'review-focus', 'proportion', 'section-order'}
        if args.case == 'interfaces':
            checks['review_focus_above_first_task'] = metrics['review_focus_above_first_task']
            checks['review_focus_has_items'] = metrics['review_focus_items'] > 0
            checks['task_code_share_at_most_0.5'] = metrics['task_code_share'] is not None and metrics['task_code_share'] <= 0.5
            checks['producer_has_produces'] = len(metrics['producer_tasks']) == 1
            checks['every_user_has_consumes'] = bool(metrics['consumer_tasks']) and not metrics['users_without_consumes']
        else:
            checks['assumptions_mention_platform'] = metrics['assumptions_mention_platform']
    seconds = json.loads((out / 'run.status.json').read_text())['seconds']
    bench.dump(out / 'metrics.json', {**metrics, 'changed_files': changed, 'seconds': round(seconds), 'spend': spend})
    bench.dump(out / 'checks.json', checks)
    print(json.dumps({'checks': checks, 'metrics': {k: metrics[k] for k in
          ('tasks', 'plan_lines', 'task_code_share', 'review_focus_items', 'producer_tasks', 'consumer_tasks', 'lint_warnings')},
          'seconds': round(seconds), 'spend': spend}, ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
