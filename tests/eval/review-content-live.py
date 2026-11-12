#!/usr/bin/env python3
"""Live check of critical-review's grading rules (synced from superpowers 6.4.1).

One headless review on a real host CLI and a real model, against a fresh
disposable repository, with the candidate (`--arm new`, the working tree) or a
git ref (`--arm old`) loaded disposably: Claude through `--plugin-dir`, Codex
through workspace skills with user config and plugins disabled. No installed
plugin, marketplace or configuration is touched. Expectations are frozen in
expected.json before the run.

Both cases ask for a product page's average star rating.

Case `implied`: the change divides by `len(reviews)`, so a product with no
reviews yet — an input the request implies but never names — raises
ZeroDivisionError. The tests cover only non-empty lists and pass. The commit
message carries the author's rationale ("kept it simple per YAGNI").
Expected of the candidate: a finding at `src/ratings.py` naming the empty
input, graded Important or Blocker, and a `Set aside` line after the table.

Case `plan`: PLAN.md decides that an empty list returns 0.0, and the change
does exactly that, with a test. A product with no reviews then shows a 0.0
rating, which reads as the worst possible score. Expected of the candidate:
a finding at `src/ratings.py` naming the empty input, labeled
`plan-mandated`, and a `Set aside` line.

In both cases, the candidate's messages to the user must not name or link
one of the skill's instruction files (`no_instruction_file_named`, the
detector of instruction_files.py).
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
from instruction_files import EXPECTED_NAMED, instruction_files_named

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cost_live', Path(__file__).with_name('cost-control-live.py'))
bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)

NEW_MARK = 'Behavior the requirements do not name'
OLD_MARK = 'edge-case bugs, missing'
REQUEST = ('Show the average star rating on each product page. Add '
           '`average_rating(reviews)` to src/ratings.py: it takes the list of a '
           "product's reviews (each a dict with an integer `stars` from 1 to 5) and "
           'returns the mean rounded to one decimal place, for the page to display.')


PLAN = ('# Plan\n\n## Task ratings\n\nAdd `average_rating(reviews: list[dict]) -> float` to '
        'src/ratings.py. Decision: an empty list returns `0.0` — keep it simple, the page '
        'always renders a number. Tests: `test_mean`, `test_rounds`, `test_empty_is_zero`.\n')


def fixture(out, case):
    repo = out / 'repo'
    (repo / 'src').mkdir(parents=True); (repo / 'tests').mkdir()
    (repo / 'src/__init__.py').write_text(''); (repo / 'tests/__init__.py').write_text('')
    (repo / '.gitignore').write_text('__pycache__/\n*.pyc\n')
    (repo / 'README.md').write_text('# Shop\nProduct catalogue helpers. Run tests with '
                                    '`python3 -m unittest discover -s tests -t .`.\n')
    (repo / 'src/products.py').write_text('def title(product: dict) -> str:\n    return product["name"].strip()\n')
    (repo / 'tests/test_products.py').write_text(
        'import unittest\nfrom src.products import title\n\n\nclass Tests(unittest.TestCase):\n'
        '    def test_title(self):\n        self.assertEqual(title({"name": " Mug "}), "Mug")\n')
    bench.git(repo, 'init', '-q', '-b', 'main')
    for k, v in [('user.name', 'Live fixture'), ('user.email', 'fixture@example.invalid'),
                 ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
        bench.git(repo, 'config', k, v)
    bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-q', '-m', 'Base')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    (repo / 'REQUEST.md').write_text('# Request\n\n' + REQUEST + '\n')
    guard = '    if not reviews:\n        return 0.0\n' if case == 'plan' else ''
    (repo / 'src/ratings.py').write_text(
        'def average_rating(reviews: list[dict]) -> float:\n' + guard +
        '    total = sum(review["stars"] for review in reviews)\n'
        '    return round(total / len(reviews), 1)\n')
    tests = ('import unittest\nfrom src.ratings import average_rating\n\n\nclass Tests(unittest.TestCase):\n'
             '    def test_mean(self):\n        self.assertEqual(average_rating([{"stars": 4}, {"stars": 5}]), 4.5)\n\n'
             '    def test_rounds(self):\n        self.assertEqual(average_rating([{"stars": 5}, {"stars": 4}, {"stars": 4}]), 4.3)\n')
    if case == 'plan':
        (repo / 'PLAN.md').write_text(PLAN)
        tests += '\n    def test_empty_is_zero(self):\n        self.assertEqual(average_rating([]), 0.0)\n'
        body = 'Implements the ratings task of PLAN.md as written.'
    else:
        body = 'Kept it simple per YAGNI: every product page has reviews in practice, so the empty case is not handled.'
    (repo / 'tests/test_ratings.py').write_text(tests)
    bench.git(repo, 'add', '.')
    bench.git(repo, 'commit', '-q', '-m', 'Add average_rating for product pages', '-m', body)
    return repo, base


def register(repo, pkg):
    registry = repo / '.agents/skills'; registry.mkdir(parents=True, exist_ok=True)
    (registry / 'critical-review').symlink_to(pkg / 'plugins/code-review/skills-codex/critical-review',
                                              target_is_directory=True)


def prompt_for(provider, base, case):
    skill = 'code-review:critical-review' if provider == 'claude' else '$critical-review'
    against = 'the request in REQUEST.md and the plan in PLAN.md' if case == 'plan' else 'the request in REQUEST.md'
    return (f'Use {skill} to review the committed change {base}..HEAD in this repository against '
            f'{against}. EVAL MODE: no user can answer and nothing may be changed — '
            'do not fix, commit or publish anything; report the review as the skill specifies.\n')


def command(provider, repo, out, pkg, model, effort, budget):
    if provider == 'claude':
        return [shutil.which('claude'), '-p', '--verbose', '--output-format', 'stream-json',
                '--model', model, '--effort', effort, '--session-id', str(uuid.uuid4()),
                '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
                '--allowedTools', 'Read,Glob,Grep,Bash,Skill,Agent',
                '--disallowedTools', 'Edit,Write,NotebookEdit',
                '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                '--add-dir', str(out), '--plugin-dir', str(pkg / 'plugins/code-review'),
                '--max-budget-usd', str(budget)]
    register(repo, pkg)
    return [shutil.which('codex'), 'exec', '--ignore-user-config', '--disable', 'plugins', '--json',
            '--skip-git-repo-check', '--model', model, '-c', f'model_reasoning_effort="{effort}"',
            '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
            '-C', str(repo), '--sandbox', 'read-only', '-']


TIER = re.compile(r'^\W*(Blocker|Important|Medium|Low|Nit)\b', re.I)
EMPTY = re.compile(r'empty|no reviews|zero reviews|without reviews|unreviewed|\[\]|ZeroDivision|divi\w* by zero', re.I)
MODULE = re.compile(r'(?<![\w/])(?:src/)?ratings\.py')  # the module, not tests/test_ratings.py


def findings_rows(answer):
    """Cells of the data rows of the findings table: the table whose header's first cell
    is Tier. Other tables (checks, set aside) are ignored."""
    rows, inside = [], False
    for line in answer.splitlines():
        if not line.lstrip().startswith('|'):
            inside = False; continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if re.fullmatch(r'[\s:|-]*', line.strip()):
            continue
        if cells and cells[0].strip('*` ').lower() == 'tier':
            inside = True; continue
        if inside:
            rows.append(cells)
    return rows


def analyze(answer):
    """Findings rows that place a finding in the ratings module (not its test file) and
    name the empty input; the tier is read from the Tier cell."""
    rows = findings_rows(answer)
    hits = [r for r in rows if any(MODULE.search(c) for c in r[1:3]) and EMPTY.search(' '.join(r))]
    tiers = [m.group(1).capitalize() for r in hits for m in [TIER.search(r[0])] if m]
    return {'finding_rows': len(rows), 'empty_input_rows': [' | '.join(r) for r in hits],
            'empty_input_tiers': tiers,
            'set_aside_line': bool(re.search(r'(?im)^\W*set aside\b', answer)),
            'plan_mandated_row': any('plan-mandated' in ' '.join(r) for r in hits)}


def answer_of(provider, rows):
    if provider == 'claude':
        return final_result(rows).get('result') or ''
    texts = [r['item'].get('text', '') for r in rows
             if r.get('type') == 'item.completed' and isinstance(r.get('item'), dict)
             and r['item'].get('type') == 'agent_message']
    return texts[-1] if texts else ''


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', required=True, choices=['claude', 'codex'])
    p.add_argument('--case', default='implied', choices=['implied', 'plan'])
    p.add_argument('--arm', default='new', choices=['new', 'old'])
    p.add_argument('--old-ref', default='HEAD')
    p.add_argument('--model')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=4)
    p.add_argument('--timeout', type=int, default=900)
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args(); out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    model = args.model or ('claude-sonnet-5-5' if args.provider == 'claude' else 'gpt-6.1-sol')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, args.arm, args.old_ref)
    repo, base = fixture(out, args.case)
    head = bench.git(repo, 'rev-parse', 'HEAD')
    mark = NEW_MARK if args.arm == 'new' else OLD_MARK
    review = pkg / 'plugins/code-review' / ('skills' if args.provider == 'claude' else 'skills-codex') / 'critical-review/REVIEW.md'
    if mark not in review.read_text(): raise SystemExit(f'snapshot lacks its arm marker: {mark!r}')
    expected = {'case': args.case, 'arm': args.arm, 'run_complete': True, 'review_loaded_from_snapshot': True,
                'no_file_changed': True, 'empty_input_finding': 'a table row naming src/ratings.py and the empty list'}
    if args.arm == 'new':
        expected['set_aside_line'] = True
        expected['no_instruction_file_named'] = EXPECTED_NAMED
        if args.case == 'implied':
            expected['empty_input_tier'] = 'Important or Blocker'
        else:
            expected['plan_mandated_row'] = 'the empty-input row is labeled plan-mandated'
            expected['empty_input_tier'] = 'Important or Blocker (a wrong rating on every new product page)'
    bench.dump(out / 'expected.json', expected)
    before = {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts}
    cmd = command(args.provider, repo, out, pkg, model, args.effort, args.budget_usd)
    bench.dump(out / 'meta.json', {'provider': args.provider, 'case': args.case, 'arm': args.arm,
        'old_ref': args.old_ref if args.arm == 'old' else None, 'model': model, 'effort': args.effort,
        'versions': versions, 'base': base, 'review': str(review),
        'loading': 'disposable --plugin-dir' if args.provider == 'claude' else 'workspace skills, user config and plugins disabled',
        'cli_version': bench.call([shutil.which(args.provider), '--version'])})
    print(f'{args.provider}/{args.case}/{args.arm}: reviewing with {model}', flush=True)
    rc = bench.run_logged(cmd, out, 'run', cwd=repo, prompt=prompt_for(args.provider, base, args.case), timeout=args.timeout)
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
    answer = answer_of(args.provider, rows)
    (out / 'answer.md').write_text(answer)
    after = {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
             for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts and '.agents' not in f.parts}
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k)
                     and not k.startswith('.agents/') and '__pycache__' not in k)
    metrics = {**analyze(answer), 'instruction_files_named': instruction_files_named(rows)}
    checks = {'run_complete': rc == 0 and complete,
              # Claude reads the snapshot path; Codex reads it there or through the workspace link.
              'review_loaded_from_snapshot': (str(review) in trace or args.provider == 'codex'
                                              and '.agents/skills/critical-review/REVIEW.md' in trace) and mark in trace,
              'no_file_changed': not changed and bench.git(repo, 'rev-parse', 'HEAD') == head,
              'empty_input_finding': bool(metrics['empty_input_rows'])}
    if args.arm == 'new':
        checks['set_aside_line'] = metrics['set_aside_line']
        checks['no_instruction_file_named'] = not metrics['instruction_files_named']
        if args.case == 'plan':
            checks['plan_mandated_row'] = metrics['plan_mandated_row']
        checks['empty_input_tier'] = bool(metrics['empty_input_tiers']) and \
            all(t in ('Important', 'Blocker') for t in metrics['empty_input_tiers'])
    seconds = json.loads((out / 'run.status.json').read_text())['seconds']
    bench.dump(out / 'metrics.json', {**metrics, 'changed_files': changed, 'seconds': round(seconds), 'spend': spend})
    bench.dump(out / 'checks.json', checks)
    print(json.dumps({'checks': checks, 'metrics': metrics, 'seconds': round(seconds), 'spend': spend},
                     ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
