#!/usr/bin/env python3
"""Live merge on the user's word, and the cleanup after any merge, on either host.

Every scenario runs in one session on a fresh fixture: the `interfaces`
repository of plan-content-live.py, a GitHub-style `origin` served from a
local bare repository, and gh-stub.py first on PATH as the pull request host
with GH_STUB_MERGE=allow, as in fable-seat-live.py's ship-e2e.

Scenarios (--scenario):
  mm-merge   Turn 1: the session runs multi-model on custom-out-cleanup-live.py's
             one-task approved plan, the runner given
             `--out <repo>/.worktrees/runs/wave-1`, integrates the result into
             `feature/durations` and pushes it. The driver opens pull request #1
             for that branch, as the user's own. Turn 2: "Merge pull request #1
             yourself." Expected: one `gh pr merge` by the session, a squash with
             no bypass; then, at once and without a question, the checkout on
             `main` at origin's tip, the feature branch removed by the cleanup
             script and deleted on origin, every run record, wave worktree and
             wave branch gone, nothing removed by hand.
  mm-merged-worktree
             As mm-merge, but the session works in a linked worktree on a branch
             of its own while `main` stays checked out in the primary checkout,
             as a per-thread worktree does. The driver merges #1 itself, as the
             user would on GitHub. Turn 2: "I merged pull request #1 on GitHub."
             Expected: no merge call by the session; the checkout detached at
             `origin/main`, since `main` is checked out elsewhere; the rest as in
             mm-merge.
  ship-merge ship end to end on a one-task request. Turn 1 should stop at the
             start approval; "Approved — start the run." follows, then at most
             two "Proceed with your recommendation." until the handoff (a pull
             request exists and the reply carries `Left behind:`), which should
             offer the merge. Last turn: "Yes — merge it." Expected: as mm-merge,
             for the branch the pull request names.

The candidate is loaded disposably, as in custom-out-cleanup-live.py: Claude
from a `--plugin-dir` snapshot with `--setting-sources project`; Codex from
workspace skills linked to the snapshot, with `--ignore-user-config` and
`--disable plugins`. A Codex session runs outside the sandbox
(`danger-full-access`) because it launches the runner, which sandboxes its
children; runner children use the normal CLI configuration. Expectations are
frozen in expected.json before the host starts. The state before the merge
turn goes to state-before.json and after it to state-after.json; checks.json
is computed from those files, the traces and the stub's call log, and
`--score DIR` recomputes it.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

from claude_session_events import read_events

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


cleanup = load('out_live', 'custom-out-cleanup-live.py')
bench, plan_live, seat = cleanup.bench, cleanup.plan_live, cleanup.seat
SCENARIOS = ('mm-merge', 'mm-merged-worktree', 'ship-merge')
FEATURE = 'feature/durations'
SEAT = cleanup.SEAT
# Text only the candidate's after-the-merge instructions carry.
FIX_MARK = 'The cleanup asks no question.'
TASK_FILES = {'src/durations.py', 'tests/test_durations.py'}
SHIP_REQUEST = ('Add `parse_duration(text)` in a new module `src/durations.py`: it turns strings such as '
                '"1h30m", "45s" and "2m" into whole seconds. Each unit (h, m, s) appears at most once and in '
                'that order; an empty string, a bare number, an unknown unit or a repeated unit raises '
                '`ValueError` naming the input. Cover it with unittest tests in `tests/test_durations.py`. '
                'Nothing else changes: the CLI, the config and the README stay as they are.')
PROMPT_MERGE = 'I opened pull request #1 for `feature/durations` into `main`. Merge it yourself.\n'
PROMPT_MERGED = 'I merged pull request #1 (`feature/durations` into `main`) on GitHub.\n'
PROMPT_YES = 'Yes — merge it.\n'
SHIP_SKILLS = {'orchestration': ['multi-model', 'super-plan', 'ship'], 'code-review': ['critical-review']}
# A question or an offer to the user at the end of a reply.
QUESTION_END = re.compile(r'\?[\s*_`)\]"»]*$')
MERGE_WORDS = re.compile(r'(?i)\bmerg|\bслей|\bслить|\bвлить|\bвлей')


def prompt_1(provider, scenario, repo):
    if scenario != 'ship-merge':
        return cleanup.prompt_1(provider, repo, 'session')
    skill = 'orchestration:ship' if provider == 'claude' else '$ship'
    text = f'Use {skill} for the change below.\n\nChange: {SHIP_REQUEST}\n'
    if provider == 'codex':
        text += 'This session runs outside a sandbox; the runner sandboxes each child it starts.\n'
    return text


def command(provider, first, sid, cwd, pkg, model, effort, budget, plugins):
    if provider == 'claude':
        cmd = [shutil.which('claude'), '-p', '--verbose', '--output-format', 'stream-json',
               '--model', model, '--effort', effort,
               '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
               '--allowedTools', 'Read,Glob,Grep,Bash,Skill,Write,Edit,Agent',
               '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
               '--add-dir', str(pkg), *[a for name in plugins for a in ('--plugin-dir', str(pkg / 'plugins' / name))],
               '--max-budget-usd', str(budget)]
        return cmd + (['--session-id', sid] if first else ['--resume', sid])
    common = ['--ignore-user-config', '--disable', 'plugins', '--json', '--skip-git-repo-check',
              '--model', model, '-c', f'model_reasoning_effort="{effort}"',
              '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false']
    if first:
        return [shutil.which('codex'), 'exec', *common, '-C', str(cwd), '--sandbox', 'danger-full-access', '-']
    return [shutil.which('codex'), 'exec', 'resume', *common, '-c', 'sandbox_mode="danger-full-access"', sid, '-']


def register(cwd, pkg, scenario):
    """Codex workspace skills linked to the snapshot, kept out of git status."""
    skills = SHIP_SKILLS if scenario == 'ship-merge' else {'orchestration': ['multi-model', 'super-plan']}
    registry = cwd / '.agents/skills'; registry.mkdir(parents=True, exist_ok=True)
    for plugin, names in skills.items():
        for name in names:
            (registry / name).symlink_to(pkg / 'plugins' / plugin / 'skills-codex' / name, target_is_directory=True)
    common = Path(bench.git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
    with (common / 'info/exclude').open('a') as f:
        f.write('\n.agents/\n')


def gh(cwd, *args):
    """The stub, called by the driver as the user."""
    r = subprocess.run([shutil.which('gh'), *args], cwd=cwd, capture_output=True, text=True, timeout=60)
    return {'argv': list(args), 'exit': r.returncode, 'out': (r.stdout + r.stderr).strip()[-600:]}


# Trace reading, shared with custom-out-cleanup-live.py.
commands, outputs, reports, replies, complete = (cleanup.commands, cleanup.outputs, cleanup.reports,
                                                 cleanup.replies, cleanup.complete)


def flat(text):
    """Tool output with Read-style line-number prefixes removed and whitespace
    collapsed, so a phrase wrapped across lines still matches."""
    return re.sub(r'\s+', ' ', re.sub(r'(?m)^[ \t]*\d+(?:\t|→)', '', text or ''))


def last_paragraph(text):
    parts = [p.strip() for p in re.split(r'\n[ \t]*\n', text or '') if p.strip()]
    return parts[-1] if parts else ''


def asks(text):
    """The reply ends by asking the user something, or offers more work."""
    tail = last_paragraph(text)
    return bool(QUESTION_END.search(tail) or seat.OFFER_RE.search(text or ''))


def offers_merge(text):
    """A paragraph of the reply asks a question about merging."""
    return any(QUESTION_END.search(p) and MERGE_WORDS.search(p)
               for p in (q.strip() for q in re.split(r'\n[ \t]*\n', text or '')) if p)


def merge_calls(calls):
    return [c for c in calls if c.get('argv', [])[:2] == ['pr', 'merge']]


def squash_merge_ok(calls):
    """Exactly one successful `gh pr merge`, a squash, and no bypass attempted."""
    merges = merge_calls(calls)
    ok = [c for c in merges if c.get('exit') == 0]
    return (len(ok) == 1 and any(a in ('--squash', '-s') for a in ok[0]['argv'])
            and not any(a in ('--admin', '--auto') for c in merges for a in c['argv']))


def removes_branch(report, name):
    return any(isinstance(item, dict) and item.get('kind') == 'branch' and item.get('branch') == name
               and 'task' not in item for item in report.get('removed') or [])


def manual_branch_removal(cmds, name):
    """The feature branch deleted by hand instead of by the cleanup script."""
    esc = re.escape(name)
    pat = re.compile(rf'git\s+(?:-C\s+\S+\s+)?(?:branch\s+[^\n;&|]*-[dD]\b[^\n;&|]*{esc}'
                     rf'|update-ref\s+-d\s+refs/heads/{esc})')
    return [c for c in cmds if pat.search(c)]


# Repository state.
def state(cwd, origin, feature):
    origin_git = cleanup.origin_git
    main = origin_git(origin, 'rev-parse', 'refs/heads/main')
    files = (origin_git(origin, 'ls-tree', '-r', '--name-only', main) or '').split() if main else []
    feature_tip = origin_git(origin, 'rev-parse', '--verify', 'refs/heads/' + feature) if feature else None
    feature_files = (origin_git(origin, 'ls-tree', '-r', '--name-only', feature_tip) or '').split() if feature_tip else []
    wt = cwd / '.worktrees'
    return {'head_branch': bench.git(cwd, 'branch', '--show-current'), 'head': bench.git(cwd, 'rev-parse', 'HEAD'),
            'origin_main': main, 'origin_main_files': files, 'origin_feature': feature_tip,
            'feature_files': feature_files,
            'branches': bench.git(cwd, 'branch', '--format=%(refname:short)').split(),
            'worktree_list': bench.git(cwd, 'worktree', 'list', '--porcelain'),
            'worktrees_dir': cleanup.listing(wt),
            'summaries': sorted(str(p.relative_to(cwd)) for p in wt.rglob('summary.json')) if wt.is_dir() else [],
            'status': bench.git(cwd, 'status', '--porcelain'), 'feature': feature}


def tests_on(origin, ref, out, name):
    clone = out / name
    if clone.exists() or not cleanup.origin_git(origin, 'rev-parse', '--verify', 'refs/heads/' + ref):
        return None
    bench.call(['git', 'clone', '-q', '-b', ref, str(origin), str(clone)])
    t = subprocess.run(seat.TESTS, cwd=clone, capture_output=True, text=True)
    (out / f'{name}-tests.txt').write_text(t.stdout + t.stderr)
    return t.returncode


def pr_list(out):
    path = out / 'gh-state.json'
    return json.loads(path.read_text()).get('prs', []) if path.exists() else []


def gh_log(out):
    path = out / 'gh-calls.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def score(out):
    meta = json.loads((out / 'meta.json').read_text())
    provider, scenario, pkg = meta['provider'], meta['scenario'], Path(meta['pkg'])
    cwd = Path(meta['cwd'])
    turns = meta.get('turns') or []
    rows = {t: read_events(out / f'{t}.stdout') for t in turns if (out / f'{t}.stdout').exists()}
    status = {t: json.loads((out / f'{t}.status.json').read_text())['exit']
              for t in turns if (out / f'{t}.status.json').exists()}
    before = json.loads((out / 'state-before.json').read_text()) if (out / 'state-before.json').exists() else {}
    after = json.loads((out / 'state-after.json').read_text()) if (out / 'state-after.json').exists() else {}
    merge_turn, handoff_turn = meta.get('merge_turn'), meta.get('handoff_turn')
    prs = pr_list(out)
    feature = (prs[0]['headRefName'] if prs else None) if scenario == 'ship-merge' else FEATURE
    # The driver's own calls all come before the merge turn starts.
    calls = gh_log(out)
    merge_session = calls[meta['merge_turn_calls_from']:] if 'merge_turn_calls_from' in meta else []
    all_rows = [r for t in turns for r in rows.get(t, [])]
    merge_rows = rows.get(merge_turn, [])
    merge_cmds = commands(merge_rows)
    merge_reports = reports(merge_rows)
    final = (replies(merge_rows) or [''])[-1]
    handoff = (replies(rows.get(handoff_turn, [])) or [''])[-1] if handoff_turn else ''
    if provider == 'claude':
        first = rows.get(turns[0], []) if turns else []
        plugin = next((p for p in cleanup.init_plugins(first) if p.get('name') == 'orchestration'), {})
        loaded = plugin.get('path') == str(pkg / 'plugins/orchestration') and plugin.get('version') == meta['versions']['orchestration']
    else:
        name = 'ship' if scenario == 'ship-merge' else 'multi-model'
        loaded = os.path.realpath(cwd / '.agents/skills' / name).startswith(os.path.realpath(pkg) + os.sep)
    detached = scenario == 'mm-merged-worktree'
    pr = prs[0] if prs else {}
    checks = {
        'candidate_loaded': loaded,
        'instruction_read': any(FIX_MARK in flat(t) for t in outputs(all_rows)),
        'turns_complete': bool(turns) and all(complete(rows.get(t, []), status.get(t)) for t in turns),
        'feature_pushed_and_green': bool(before) and TASK_FILES <= set(before.get('feature_files') or [])
                                    and before.get('feature_tests_rc') == 0 and before.get('origin_main') == meta['base'],
        'pr_ready_before_merge': bool(pr) and pr.get('headRefName') == feature and pr.get('baseRefName') == 'main'
                                 and (before.get('pr_state') == ('MERGED' if detached else 'OPEN')),
        'merge_by_session': (not merge_calls(merge_session)) if detached else squash_merge_ok(merge_session),
        'merged_on_origin': pr.get('state') == 'MERGED' and TASK_FILES <= set(after.get('origin_main_files') or [])
                            and after.get('main_tests_rc') == 0,
        'checkout_left_feature': bool(after) and after.get('head') == after.get('origin_main')
                                 and after.get('head_branch') == ('' if detached else 'main'),
        'feature_removed_by_script': any(r.get('dryRun') is False and removes_branch(r, feature) for r in merge_reports),
        'feature_gone_local': bool(after) and feature not in (after.get('branches') or []),
        'feature_gone_origin': bool(after) and after.get('origin_feature') is None,
        'run_leftovers_gone': bool(after) and not after.get('summaries')
                              and not any('/.worktrees/' in line for line in after.get('worktree_list', '').splitlines()
                                          if line.startswith('worktree '))
                              and not any(b.startswith('wave/') for b in after.get('branches') or []),
        'no_removal_by_hand': not any(cleanup.MANUAL.search(c) for t in turns for c in commands(rows.get(t, [])))
                              and not manual_branch_removal(merge_cmds, feature or FEATURE),
        'no_question_after_merge': bool(merge_rows) and not asks(final),
    }
    if scenario == 'ship-merge':
        checks['handoff_offers_merge'] = offers_merge(handoff)
    facts = {'feature': feature, 'merge_calls': merge_calls(merge_session),
             'merge_turn_commands': merge_cmds, 'merge_turn_reports': merge_reports,
             'manual_branch_removal': manual_branch_removal(merge_cmds, feature or FEATURE),
             'handoff_last_paragraph': last_paragraph(handoff), 'final_reply': final,
             'head_after': after.get('head_branch'), 'branches_after': after.get('branches'),
             'summaries_after': after.get('summaries'), 'origin_feature_after': after.get('origin_feature'),
             'script_paths': cleanup.script_paths([c for t in turns for c in commands(rows.get(t, []))])}
    bench.dump(out / 'checks.json', {'checks': checks, 'facts': facts})
    return checks, facts


def spend(out, provider, turns):
    found, last = {}, 0.0
    for t in turns:
        path = out / f'{t}.stdout'
        if not path.exists():
            continue
        rows = read_events(path)
        seconds = json.loads((out / f'{t}.status.json').read_text())['seconds']
        if provider == 'claude':
            totals = [r.get('total_cost_usd') for r in rows if r.get('type') == 'result' and r.get('total_cost_usd') is not None]
            cost = round(totals[-1] - last, 4) if totals else None   # a resumed session reports a running total
            last = totals[-1] if totals else last
            found[t] = {'usd': cost, 'seconds': round(seconds)}
        else:
            done = [r.get('usage') for r in rows if r.get('type') == 'turn.completed']
            found[t] = {'seconds': round(seconds), 'usage': done[-1] if done else None}
    return found


EXPECTED = {
    'candidate_loaded': 'claude: the init event lists the snapshot plugin and version; codex: the workspace '
                        'skill resolves into the snapshot',
    'instruction_read': f'a tool output carries the new after-the-merge text ({FIX_MARK!r})',
    'turns_complete': 'every invocation ends in success',
    'feature_pushed_and_green': 'before the merge turn the feature branch on origin has src/durations.py and '
                                'tests/test_durations.py, its tests pass, and origin main is unchanged',
    'pr_ready_before_merge': 'pull request #1 from the feature branch into main exists before the merge turn: open '
                             '(mm-merge, ship-merge) or merged by the driver (mm-merged-worktree)',
    'merge_by_session': 'mm-merge, ship-merge: exactly one successful gh pr merge in the merge turn, with --squash, '
                        'and no --admin or --auto; mm-merged-worktree: no gh pr merge at all',
    'merged_on_origin': 'the pull request is merged, origin main has the task files and its tests pass',
    'checkout_left_feature': 'after the merge turn the checkout is at origin main: on main, or detached in '
                             'mm-merged-worktree, where main is checked out in the primary checkout',
    'feature_removed_by_script': 'a merge-turn wave-cleanup.mjs report with dryRun false lists the feature branch '
                                 'under removed',
    'feature_gone_local': 'the feature branch no longer exists locally',
    'feature_gone_origin': 'the feature branch no longer exists on origin',
    'run_leftovers_gone': 'no summary.json under .worktrees, no worktree registered under .worktrees and no wave/* '
                          'branch',
    'no_removal_by_hand': 'no rm, rmdir, rmtree, find -delete or git worktree remove under .worktrees, and no '
                          'git branch -d/-D or update-ref -d of the feature branch',
    'no_question_after_merge': "the merge turn's last reply neither ends with a question nor offers more work",
}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', choices=['claude', 'codex'])
    p.add_argument('--scenario', choices=SCENARIOS)
    p.add_argument('--model')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=8, help='Claude: cap per invocation')
    p.add_argument('--out', type=Path)
    p.add_argument('--score', type=Path, help='Recompute checks.json of a retained run directory')
    p.add_argument('--prepare-only', action='store_true', help='Build the fixture; no model call')
    args = p.parse_args()
    if args.score:
        checks, facts = score(args.score.resolve())
        print(json.dumps({'checks': checks, 'facts': facts}, ensure_ascii=False, indent=1))
        return 0 if all(checks.values()) else 1
    if not (args.provider and args.scenario and args.out):
        p.error('--provider, --scenario and --out are required')
    out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    model = args.model or SEAT[args.provider]
    ship = args.scenario == 'ship-merge'
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, 'new', 'HEAD')
    repo, _ = plan_live.fixture(out, 'interfaces')
    if ship:
        (repo / 'AGENTS.md').write_text('Read README.md before changing the repository.\n')
        bench.git(repo, 'commit', '-q', '-a', '--amend', '-m', 'Frozen fixture')
    else:
        plan = repo / seat.PLAN_REL; plan.parent.mkdir(parents=True)
        plan.write_text(cleanup.plan_text(args.provider))
        bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-q', '-m', 'Approved wave plan')
        lint = subprocess.run(['node', str(pkg / seat.LINT), str(plan), '--repo', str(repo)], capture_output=True, text=True)
        (out / 'lint-before.txt').write_text(lint.stdout + lint.stderr)
        if lint.returncode:
            raise SystemExit('fixture plan is not lint-clean:\n' + lint.stdout + lint.stderr)
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', '-b', 'main', str(origin)])
    seat.e2e_environment(out, origin)
    os.environ['GH_STUB_MERGE'] = 'allow'
    bench.git(repo, 'remote', 'add', 'origin', seat.GH_URL)
    bench.git(repo, 'push', '-q', '-u', 'origin', 'main')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    cwd = repo
    if args.scenario == 'mm-merged-worktree':
        cwd = out / 'thread'
        bench.git(repo, 'worktree', 'add', '-q', '-b', 'thread/merge-check', str(cwd), 'main')
    if args.provider == 'codex':
        register(cwd, pkg, args.scenario)
    plugins = ('orchestration', 'code-review') if ship else ('orchestration',)
    bench.dump(out / 'expected.json', {'provider': args.provider, 'scenario': args.scenario, 'seat_model': model,
                                       'effort': args.effort, **EXPECTED,
                                       **({'handoff_offers_merge': "the handoff reply's last paragraph asks a "
                                           'question about merging'} if ship else {})})
    meta = {'provider': args.provider, 'scenario': args.scenario, 'model': model, 'effort': args.effort,
            'versions': versions, 'base': base, 'pkg': str(pkg), 'repo': str(repo), 'cwd': str(cwd),
            'origin_url': seat.GH_URL, 'turns': [], 'driver_calls': [],
            'loading': 'disposable --plugin-dir, --setting-sources project' if args.provider == 'claude'
            else 'workspace skills linked to the snapshot, user config and plugins off',
            'children': 'runner children use the normal CLI configuration; gh-stub.py is the pull request host',
            'cli_version': bench.call([shutil.which(args.provider), '--version'])}
    bench.dump(out / 'meta.json', meta)
    if args.prepare_only:
        print(json.dumps({'prepared': str(out), 'cwd': str(cwd), 'gh': gh(cwd, 'auth', 'status')}, indent=1)); return 0

    sid = str(uuid.uuid4()) if args.provider == 'claude' else None

    def turn(prompt, timeout, budget):
        nonlocal sid
        name = f'turn-{len(meta["turns"]) + 1}'
        print(f'{args.provider}/{args.scenario}: {name}', flush=True)
        meta['turns'].append(name); bench.dump(out / 'meta.json', meta)
        rc = bench.run_logged(command(args.provider, name == 'turn-1', sid, cwd, pkg, model, args.effort, budget, plugins),
                              out, name, cwd=cwd, prompt=prompt, timeout=timeout)
        rows = read_events(out / f'{name}.stdout')
        sid = cleanup.session_id(rows, sid)
        return name, complete(rows, rc), rows

    def as_user(*argv):
        result = gh(cwd, *argv)
        meta['driver_calls'].append(result); bench.dump(out / 'meta.json', meta)
        return result

    name, ok, rows = turn(prompt_1(args.provider, args.scenario, cwd), 1200 if ship else 2400, args.budget_usd)
    if ship:
        for prompt, timeout in ((seat.APPROVE, 3600), (seat.PROCEED, 900), (seat.PROCEED, 900)):
            text = (replies(rows) or [''])[-1]
            if not ok or (pr_list(out) and re.search(cleanup.MARK.format('left behind'), text)):
                break
            name, ok, rows = turn(prompt, timeout, max(args.budget_usd, 15))
        meta['handoff_turn'] = name
    feature = (pr_list(out)[0]['headRefName'] if pr_list(out) else None) if ship else FEATURE
    # The state the work turns left, before the user's pull request steps move anything.
    before = state(cwd, origin, feature) if feature else {}
    if before.get('origin_feature'):
        before['feature_tests_rc'] = tests_on(origin, feature, out, 'feature-clone')
    if not ship and ok and before.get('origin_feature'):
        as_user('pr', 'create', '--head', FEATURE, '--base', 'main', '--title', 'Add parse_duration',
                '--body', 'The duration parser from the approved wave plan.')
        if args.scenario == 'mm-merged-worktree':
            as_user('pr', 'merge', '1', '--squash')
    before['pr_state'] = pr_list(out)[0]['state'] if pr_list(out) else None
    bench.dump(out / 'state-before.json', before)
    ready = ok and feature and before.get('pr_state') in ('OPEN', 'MERGED')
    if ready:
        meta['merge_turn_calls_from'] = len(gh_log(out))
        prompt = PROMPT_YES if ship else PROMPT_MERGED if args.scenario == 'mm-merged-worktree' else PROMPT_MERGE
        name, ok, rows = turn(prompt, 900, min(args.budget_usd, 4))
        meta['merge_turn'] = name; bench.dump(out / 'meta.json', meta)
        after = state(cwd, origin, feature)
        after['main_tests_rc'] = tests_on(origin, 'main', out, 'main-clone')
        bench.dump(out / 'state-after.json', after)
    bench.dump(out / 'meta.json', meta)
    checks, facts = score(out)
    bench.dump(out / 'spend.json', spend(out, args.provider, meta['turns']))
    print(json.dumps({'checks': checks, 'facts': {k: facts[k] for k in ('feature', 'merge_calls', 'head_after',
                      'manual_branch_removal', 'summaries_after')},
                      'spend': json.loads((out / 'spend.json').read_text())}, ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
