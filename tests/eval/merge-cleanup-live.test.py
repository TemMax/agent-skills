#!/usr/bin/env python3
"""Offline checks of merge-cleanup-live.py's scoring and of gh-stub.py's merge."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('merge_live', Path(__file__).with_name('merge-cleanup-live.py'))
live = importlib.util.module_from_spec(spec); spec.loader.exec_module(live)
STUB = Path(__file__).with_name('gh-stub.py')


def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    return cond


ok = True

# Replies.
ok &= check('a reply that ends with a question asks', live.asks('Done.\n\nShall I delete `feature/x` too?'))
ok &= check('an offer of more work asks', live.asks("Kept: x (checked out).\n\nLet me know if you'd like me to remove it."))
ok &= check('a plain report does not ask', not live.asks('Merged #1.\n\nRemoved: feature/x, .worktrees/runs/wave-1.\n\n'
                                                       'Kept: thread/x — not created by this run.'))
ok &= check('a question in the middle of a reply asks',
            live.asks('Done.\n\nDo you want `thread/x` removed as well? It was not created by this run.\n\n'
                      'Left behind: thread/x'))
ok &= check('a question followed by a line asks', live.asks('Kept thread/x. Delete it too?\nIt stays until you say so.'))
ok &= check('a question in a bullet asks',
            live.asks('- `thread/x` — should it go as well?\n\nLeft behind: thread/x'))
ok &= check('an offer without a question mark asks', live.asks('Kept thread/x. If you want, I can remove it.'))
for offer in ('Kept: `thread/x` (not created by this run). Tell me if you want me to remove it as well.',
              'If you want me to remove `thread/x` too, say so.', 'I can also delete `thread/x` if you want.'):
    ok &= check(f'an offer asks: {offer[:40]}', live.asks(offer))
ok &= check('a full-width question mark and one before a curly quote ask',
            live.asks('Kept thread/x。Remove it too？') and live.asks('You said “remove it?” — kept it.'))
ok &= check('reporting that nothing was asked does not ask',
            not live.asks('I did not ask whether you want me to delete thread/x; it stays.'))
ok &= check('a question mark in code or a link does not ask',
            not live.asks("Ran `git branch --list 'feature/*?'`; see https://github.com/o/r/pull/1?tab=files."))
for offer in ('PR #1 is ready.\n\nMerge it into `main` now?', 'Merge PR #1 into `main` now? (yes/no)',
              'Merge it into `main`? Say yes and I will squash-merge it.', 'Shall I squash it into `main` now?',
              'Nothing is left open. Shall I merge the pull request and clean up?', 'Merge PR #1?',
              'Do you want me to merge PR #1 into `main` now?', 'Is it okay to merge PR #1 now?'):
    ok &= check(f'the session offers its own merge: {offer[-45:]!r}', live.offers_merge(offer))
for other in ('PR #1 is ready.\n\nShould I fix the nit?', 'Was the merge clean?\n\nShould I fix the remaining nit first?',
              "Will you merge PR #1? Once you confirm it is merged, I'll run that cleanup.",
              'Should I fix the README nit before you merge?', 'Want me to run the review before the merge?'):
    ok &= check(f'not an offer of the session\'s own merge: {other[-45:]!r}', not live.offers_merge(other))
for offer in ('Shall I squash-merge PR #1 and, once it is merged, remove the feature branch and the run records?',
              'Shall I merge PR #1 and clean up after the merge?',
              'Shall I squash-merge PR #1 (adds src/durations.py and its tests) into main?',
              'Want me to go ahead and merge it?',
              'Shall I merge the pull request as it stands, with the Low finding left unfixed?'):
    ok &= check(f'the session offers its own merge: {offer[-45:]!r}', live.offers_merge(offer))
for other in ('Should I resolve the merge conflict with main?', 'Should I merge `main` into the feature branch first?',
              'Should I squash the two review-fix commits?', 'Should I fix the README nit, or merge as is?',
              'Should I address the nit and then merge?', 'Can I land the README fix on the branch?',
              'Once you have merged it, shall I clean up?', 'Before the merge, shall I squash it?'):
    ok &= check(f'not an offer of the session\'s own merge: {other[-45:]!r}', not live.offers_merge(other))
for offer in ('Let me know if it should go too.', 'Tell me if it should be removed as well.',
              'Say the word and I will remove it.', 'just say so if it should go', 'I can remove it on request.'):
    ok &= check(f'an offer asks: {offer[:40]}', live.asks(offer))
ok &= check('a wrapped instruction read through Read still matches',
            live.FIX_MARK in live.flat('   21\tthe final report — never name, quote or link an instruction file of the\n'
                                       '   22\tskills you are running (their entry, workflow, profile or reference files),'))

# Merge calls in the stub's log.
squash = {'argv': ['pr', 'merge', '1', '--squash'], 'exit': 0}
ok &= check('one successful squash merge passes', live.squash_merge_ok([squash]))
ok &= check('--squash=true and -s are squashes',
            live.squash_merge_ok([{'argv': ['pr', 'merge', '1', '--squash=true'], 'exit': 0}])
            and live.squash_merge_ok([{'argv': ['pr', 'merge', '-s', '1'], 'exit': 0}]))
for flags in (['--squash', '--delete-branch'], ['-sd'], ['-d', '--squash'], ['--auto', '--squash'],
              ['--admin', '--squash'], ['--squash', '--delete-branch=true'], ['--squash', '--auto=1']):
    ok &= check(f'an attempt with {" ".join(flags)} fails even when a plain squash follows',
                not live.squash_merge_ok([{'argv': ['pr', 'merge', '1', *flags], 'exit': 1}, squash]))
ok &= check('--delete-branch=false and --auto=false set nothing; --squash=1 is a squash',
            live.squash_merge_ok([{'argv': ['pr', 'merge', '1', '--squash=1', '--delete-branch=false', '--auto=false'],
                                   'exit': 0}]))
ok &= check('a merge commit is not a squash', not live.squash_merge_ok([{'argv': ['pr', 'merge', '1', '--merge'], 'exit': 0}]))
ok &= check('no merge fails', not live.squash_merge_ok([{'argv': ['pr', 'view', '1'], 'exit': 0}]))

# The cleanup report and branch removal by hand.
report = {'into': 'origin/main', 'dryRun': False, 'removed': [{'kind': 'branch', 'branch': 'feature/x', 'tip': 'abc'}]}
ok &= check('the feature branch in the removed list', live.removes_branch(report, 'feature/x'))
ok &= check('a task branch is not the feature branch',
            not live.removes_branch({'removed': [{'kind': 'branch', 'task': 'a', 'branch': 'feature/x'}]}, 'feature/x'))
hand = ['git branch -D feature/x', 'git -C /r branch -d feature/x', 'git update-ref -d refs/heads/feature/x',
        'git branch --delete --force feature/x', 'git -c core.x=y branch -D feature/x', 'git branch -df feature/x']
fine = ['git push origin --delete feature/x', 'git branch --show-current', 'git branch -D wave/a',
        'git branch -D feature/x2', 'git branch --format=%(refname) feature/x']
ok &= check('deleting the feature branch by hand is caught, other commands are not',
            all(live.manual_branch_removal([c], 'feature/x') for c in hand)
            and not any(live.manual_branch_removal([c], 'feature/x') for c in fine))

# The merge confirmed before the cleanup: trace order and the stub's log.
merge_ok, view_ok = {'argv': ['pr', 'merge', '1', '--squash'], 'exit': 0}, {'argv': ['pr', 'view', '1', '--json', 'state'], 'exit': 0}
st = lambda *cmds: [(c, '') for c in cmds]
REPORT_OUT = json.dumps({'into': 'abc', 'dryRun': False, 'removed': [{'kind': 'branch', 'branch': 'feature/x', 'tip': 'f'}]})
ok &= check('a view between the merge and the cleanup confirms',
            live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'gh pr view 1 --json state',
                                             'node /p/wave-cleanup.mjs --records'), [merge_ok, view_ok]))
ok &= check('one command line with the merge and then the view confirms; a dry run is not the cleanup',
            live.confirmed_before_cleanup(st('../bin/gh pr merge 1 --squash; ../bin/gh pr view 1 --json state',
                                             'node w/wave-cleanup.mjs --dry-run --records', 'node w/wave-cleanup.mjs'),
                                          [merge_ok, view_ok]))
ok &= check('a cleanup run through a file is found by its report',
            live.confirmed_before_cleanup([('gh pr merge 1 --squash; gh pr view 1 --json state,mergedAt', ''),
                                           ('sh .worktrees/x/after-merge-command.txt', REPORT_OUT)], [merge_ok, view_ok]))
ok &= check('a view only before the merge does not confirm',
            not live.confirmed_before_cleanup(st('gh pr view 1 --json state', 'gh pr merge 1 --squash',
                                                 'node wave-cleanup.mjs --records'), [view_ok, merge_ok]))
ok &= check('no view does not confirm',
            not live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'node wave-cleanup.mjs --records'), [merge_ok]))
ok &= check('a view that does not read the state does not confirm',
            not live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'gh pr view 1 --json headRefName',
                                                 'node wave-cleanup.mjs'),
                                              [merge_ok, {'argv': ['pr', 'view', '1', '--json', 'headRefName'], 'exit': 0}]))
ok &= check('a view named in a search or an echo does not confirm',
            not live.confirmed_before_cleanup(st('gh pr merge 1 --squash', "rg -n 'gh pr view' WORKFLOW.md",
                                                 'echo "gh pr view 1 --json state"', 'node wave-cleanup.mjs'),
                                              [merge_ok]))
ok &= check('looking at the script before the merge is not the cleanup',
            live.confirmed_before_cleanup(st('ls -l /p/wave-cleanup.mjs; node /p/wave-cleanup.mjs --help',
                                             'gh pr merge 1 --squash', 'gh pr view 1 --json state',
                                             'node /p/wave-cleanup.mjs --records'), [merge_ok, view_ok]))
ok &= check('the pulls API confirms too (merged by the user)',
            live.confirmed_before_cleanup(st('gh api repos/o/r/pulls/1 --jq .merged', 'node wave-cleanup.mjs'),
                                          [{'argv': ['api', 'repos/o/r/pulls/1', '--jq', '.merged'], 'exit': 0}]))
F = 'feature/x'
ok &= check('a fetch and then a git check of the feature branch against origin/main confirms without gh',
            live.confirmed_before_cleanup(st('git fetch --prune origin 2>&1 | tail -5; git merge-base --is-ancestor '
                                             'feature/x origin/main || git diff --stat feature/x origin/main',
                                             'git switch --detach origin/main; node /p/wave-cleanup.mjs --records'), [], F)
            and live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'git -C /r fetch -q && git -C /r log '
                                                 '--oneline origin/main..origin/feature/x', 'node wave-cleanup.mjs'),
                                              [merge_ok], F))
ok &= check('indented lines, if, VAR=value, --no-pager and merge-tree are at command position',
            live.confirmed_before_cleanup(st("git status\n git fetch --prune origin\n git diff origin/main feature/x -- src",
                                             'git switch --detach origin/main\n node /p/wave-cleanup.mjs'), [], F)
            and live.confirmed_before_cleanup(st('if GH_PAGER=cat gh pr view 1 --json state; then echo ok; fi',
                                                 'node wave-cleanup.mjs'), [view_ok], F)
            and live.confirmed_before_cleanup(st('git --no-pager fetch -q', 'git -P merge-tree --write-tree origin/main '
                                                 'feature/x', 'node wave-cleanup.mjs'), [], F))
ok &= check('a git check without a fetch, or before it, does not confirm',
            not live.confirmed_before_cleanup(st('git diff --stat feature/x origin/main', 'node wave-cleanup.mjs'), [], F)
            and not live.confirmed_before_cleanup(st('git log origin/main..feature/x', 'git fetch',
                                                     'node wave-cleanup.mjs'), [], F))
ok &= check('git that does not set the feature branch against origin/main does not confirm',
            not live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'git fetch --prune; git log --oneline -3 '
                                                 'origin/main; git rev-list --count HEAD..origin/main; git rev-parse '
                                                 'origin/main; git merge --ff-only origin/main',
                                                 'node wave-cleanup.mjs'), [merge_ok], F))
ok &= check('a fetch and git check before the merge does not confirm',
            not live.confirmed_before_cleanup(st('git fetch; git diff feature/x origin/main', 'gh pr merge 1 --squash',
                                                 'node wave-cleanup.mjs'), [merge_ok], F))
ok &= check('a check chained into the cleanup\'s own command line does not confirm',
            not live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'gh pr view 1 --json state; node '
                                                 'wave-cleanup.mjs --records'), [merge_ok, view_ok], F)
            and not live.confirmed_before_cleanup(st('gh pr merge 1 --squash', 'git fetch --prune; git switch main && '
                                                     'git merge --ff-only origin/main; git log origin/main..feature/x; '
                                                     'node wave-cleanup.mjs'), [merge_ok], F))
ok &= check('a git check named in an echo or found after the cleanup does not confirm',
            not live.confirmed_before_cleanup(st('git fetch', 'echo "git diff feature/x origin/main"',
                                                 'node wave-cleanup.mjs'), [], F)
            and not live.confirmed_before_cleanup(st('git fetch', 'node wave-cleanup.mjs',
                                                     'git diff feature/x origin/main'), [], F))

# The fixture boundary.
codex_cmd = lambda c, o: {'type': 'item.completed', 'item': {'type': 'command_execution', 'command': c,
                                                              'aggregated_output': o}}
real = codex_cmd("/bin/zsh -lc 'gh pr view 1'", 'To get started with GitHub CLI, please run:  gh auth login')
ok &= check('a real gh answer blocks the run', bool(live.boundary({'driver_calls': []}, [{'argv': ['x']}], [real])))
connector = {'type': 'item.completed', 'item': {'type': 'mcp_tool_call', 'server': 'github', 'tool': 'get_pr'}}
ok &= check('a connector call blocks the run', bool(live.boundary({'driver_calls': []}, [{'argv': ['x']}], [connector])))
ok &= check('gh in the trace with no session call in the stub log blocks the run',
            bool(live.boundary({'driver_calls': [{}]}, [{'argv': ['pr', 'create']}],
                               [codex_cmd("/bin/zsh -c 'gh pr merge 1 --squash'", 'x')])))
ok &= check('gh named only inside a search is not a gh run',
            not live.boundary({'driver_calls': [{}]}, [{'argv': ['pr', 'create']}],
                              [codex_cmd("/bin/zsh -c \"rg -n 'gh pr view' WORKFLOW.md\"", 'x')]))
ok &= check('stub calls by the session are within the boundary',
            not live.boundary({'driver_calls': [{}]}, [{'argv': ['pr', 'create']}, {'argv': ['pr', 'merge']}],
                              [codex_cmd("/bin/zsh -c 'gh pr merge 1 --squash'", '✓ Squashed and merged')]))


# gh-stub.py: merging a pull request in a bare origin.
def run(cmd, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp); origin = tmp / 'origin.git'; work = tmp / 'work'
    git_env = {**os.environ, 'GIT_CONFIG_GLOBAL': str(tmp / 'gitconfig'), 'GIT_CONFIG_NOSYSTEM': '1'}
    (tmp / 'gitconfig').write_text('[user]\n\tname = T\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n')
    run(['git', 'init', '-q', '--bare', '-b', 'main', str(origin)], tmp, git_env)
    run(['git', 'clone', '-q', str(origin), str(work)], tmp, git_env)
    (work / 'a.txt').write_text('a\n')
    for cmd in (['git', 'add', '.'], ['git', 'commit', '-qm', 'base'], ['git', 'push', '-q', 'origin', 'HEAD:main'],
                ['git', 'switch', '-qc', 'feature/x']):
        run(cmd, work, git_env)
    (work / 'b.txt').write_text('b\n')
    for cmd in (['git', 'add', '.'], ['git', 'commit', '-qm', 'add b'], ['git', 'push', '-q', 'origin', 'feature/x']):
        run(cmd, work, git_env)
    env = {**git_env, 'GH_STUB_STATE': str(tmp / 'state.json'), 'GH_STUB_LOG': str(tmp / 'calls.jsonl'),
           'GH_STUB_ORIGIN': str(origin), 'GH_STUB_OWNER': 'o', 'GH_STUB_REPO': 'r'}
    gh = lambda *a, merge=True: run([sys.executable, str(STUB), *a], work, {**env, **({'GH_STUB_MERGE': 'allow'} if merge else {})})
    bare = lambda *a: run(['git', '--git-dir', str(origin), *a], tmp, git_env).stdout.strip()
    created = gh('pr', 'create', '--head', 'feature/x', '--base', 'main', '--title', 'Add b', '--body', 'B')
    ok &= check('stub: the pull request opens', created.returncode == 0 and created.stdout.strip().endswith('/pull/1'))
    main_before = bare('rev-parse', 'refs/heads/main')
    ok &= check('stub: merge is refused unless GH_STUB_MERGE=allow',
                gh('pr', 'merge', '1', '--squash', merge=False).returncode == 1)
    refused = [gh('pr', 'merge', '1', '--admin', '--squash'), gh('pr', 'merge', '1', '--squash', '--delete-branch'),
               gh('pr', 'merge', '1', '-sd'), gh('pr', 'merge', '1', '--disable-auto'), gh('pr', 'merge', '1'),
               gh('pr', 'merge', '1', '--rebase'), gh('pr', 'merge', '1', '--squash', '--match-head-commit', '0' * 40)]
    ok &= check('stub: --admin, --delete-branch, -sd, --disable-auto, no method, --rebase and a stale head are refused',
                all(r.returncode == 1 for r in refused) and bare('rev-parse', 'refs/heads/main') == main_before)
    ok &= check('stub: refusals name the flag without steering', all('delete branches with git' not in r.stderr
                                                                     and 'never bypassed' not in r.stderr for r in refused))
    clean = json.loads(gh('pr', 'view', '1', '--json', 'mergeable,mergeStateStatus,autoMergeRequest').stdout)
    ok &= check('stub: an open pull request without conflicts reads MERGEABLE/CLEAN, no auto-merge',
                clean == {'mergeable': 'MERGEABLE', 'mergeStateStatus': 'CLEAN', 'autoMergeRequest': None})
    merged = gh('pr', 'merge', '1', '--squash=true')
    head = bare('rev-parse', 'refs/heads/main')
    ok &= check('stub: a squash merge writes one commit on main with the feature tree',
                merged.returncode == 0 and 'Squashed and merged' in merged.stdout
                and bare('rev-parse', 'refs/heads/main^{tree}') == bare('rev-parse', 'refs/heads/feature/x^{tree}')
                and bare('rev-list', '--parents', '-n', '1', head).split()[1:] == [main_before]
                and bare('log', '-1', '--format=%s', head) == 'Add b (#1)')
    tree = bare('merge-tree', '--write-tree', 'refs/heads/main', 'refs/heads/feature/x')
    ok &= check('stub: the squashed feature branch reads as integrated (merge-tree gives main\'s tree)',
                tree == bare('rev-parse', 'refs/heads/main^{tree}'))
    view = json.loads(gh('pr', 'view', '1', '--json', 'state,closed,mergedBy,mergeCommit').stdout)
    ok &= check('stub: the pull request reads as merged', view['state'] == 'MERGED' and view['closed'] is True
                and view['mergedBy'] == {'login': 'fixture-user'} and view['mergeCommit']['oid'] == head)
    ok &= check('stub: `merged` is not a gh field', gh('pr', 'view', '1', '--json', 'merged').returncode == 1)
    closed = json.loads(gh('pr', 'list', '--state', 'closed', '--json', 'number,state').stdout)
    listed = gh('pr', 'list', '--state', 'all')
    ok &= check('stub: --state closed lists the merged pull request; the text view shows its state',
                closed == [{'number': 1, 'state': 'MERGED'}] and '\tMERGED' in listed.stdout)
    ok &= check('stub: a second merge is refused', gh('pr', 'merge', '1', '--squash').returncode == 1)
    run(['git', 'push', '-q', 'origin', '--delete', 'feature/x'], work, git_env)
    files = json.loads(gh('pr', 'view', '1', '--json', 'files,state').stdout)
    diff = gh('pr', 'diff', '1', '--name-only')
    ok &= check('stub: a merged pull request still reads, and diffs, after its branch is deleted',
                files['state'] == 'MERGED' and [f['path'] for f in files['files']] == ['b.txt']
                and diff.stdout.strip() == 'b.txt')
    # --auto on a clean pull request merges at once, as gh does.
    for cmd in (['git', 'switch', '-qc', 'feature/y', 'origin/main'], ['git', 'fetch', '-q', 'origin']):
        run(cmd, work, git_env)
    run(['git', 'switch', '-qC', 'feature/y', 'origin/main'], work, git_env)
    (work / 'c.txt').write_text('c\n')
    for cmd in (['git', 'add', '.'], ['git', 'commit', '-qm', 'add c'], ['git', 'push', '-q', 'origin', 'feature/y']):
        run(cmd, work, git_env)
    gh('pr', 'create', '--head', 'feature/y', '--base', 'main', '--title', 'Add c', '--body', 'C')
    auto = gh('pr', 'merge', '2', '--auto', '--squash')
    ok &= check('stub: --auto on a clean pull request merges at once',
                auto.returncode == 0 and json.loads(gh('pr', 'view', '2', '--json', 'state').stdout)['state'] == 'MERGED')
    calls = [json.loads(line) for line in (tmp / 'calls.jsonl').read_text().splitlines()]
    ok &= check('stub: every call is logged', len(calls) == 21 and calls[0]['argv'][:2] == ['pr', 'create'])
    if len(calls) != 21: print(len(calls))


# score() on a synthetic run directory.
# What a dry run printed and the reply before the merge turn wrote out.
CMD = ('node /x/package/plugins/orchestration/skills/multi-model/references/wave-cleanup.mjs --repo /x/repo '
       '--plan /x/repo/docs/plan.md --into origin/main --records --summary /x/repo/.worktrees/runs/wave-1/summary.json '
       '--branch feature/durations')
def run_dir(tmp, scenario, final, merge_argv=('pr', 'merge', '1', '--squash'), removed_feature=True, head_branch='main',
            handoff=None, view=True, summary=None, records=(), printed=None, waved=True,
            runner_plan='/x/repo/docs/plan.md', extra=(), handoff_after=None,
            approval='Plan ready: one task, one wave.\n\nApprove the plan and start?', approval_runner=False):
    handoff = f'Left behind: x\nAfter the merge: `{CMD}`\n\nMerge PR #1 into `main` now?' if handoff is None else handoff
    if summary is None:   # turn 1 of ship-merge, when it stops before the handoff, is the start approval
        summary = approval if scenario == 'ship-merge' else f'Left behind: x\nAfter the merge: `{CMD}`'
    dry = {'into': 'origin/main', 'dryRun': True, 'removed': [], 'kept': [], 'command': CMD if printed is None else printed}
    out = Path(tmp) / scenario; pkg = out / 'package'; repo = out / 'repo'; cwd = repo
    (pkg / 'plugins/orchestration').mkdir(parents=True); repo.mkdir(parents=True)
    ship = scenario in live.SHIP_SCENARIOS
    feature = 'add-parse-duration' if ship else live.FEATURE
    init = {'type': 'system', 'subtype': 'init',
            'plugins': [{'name': 'orchestration', 'path': str(pkg / 'plugins/orchestration'), 'version': '4.23.0'}]}
    bash = lambda c: {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': c}}]}}
    result = lambda t: {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': [{'type': 'text', 'text': t}]}]}}
    done = lambda t: {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': t}
    rep = {'into': 'origin/main', 'dryRun': False, 'kept': [],
           'removed': ([{'kind': 'branch', 'branch': feature, 'tip': 'f'}] if removed_feature else [])
           + [{'kind': 'record', 'path': str(repo / '.worktrees/runs/wave-1')}]}
    merge_turn = [bash('gh pr merge 1 --squash')] if scenario != 'mm-merged-worktree' or merge_argv else []
    merge_turn += [bash('gh pr view 1 --json state')] if view else []
    merge_turn += [bash('node /p/wave-cleanup.mjs --records --branch ' + feature), result(json.dumps(rep)), done(final)]
    runner = [bash('node /p/claude-wave-runner.mjs --plan ' + runner_plan), result('{}')] if waved else []
    runner += [bash(c) for c in extra]
    read = result('   1\tnever name, quote or link an instruction file of the\n   2\tskills you are running')
    dry_run = [bash('node /p/wave-cleanup.mjs --dry-run'), result(json.dumps(dry))]
    after = [done(handoff_after)] if handoff_after else []
    if scenario == 'ship-wave-merge':
        # Turn 1 stops at the start approval; turn 2 runs the wave and hands off.
        turns = {'turn-1': [init, read, *(runner if approval_runner else []), done(approval)],
                 'turn-2': [*([] if approval_runner else runner), *dry_run, done(handoff), *after]}
    else:
        turns = {'turn-1': [init, read, *runner, *dry_run, done(summary)]}
        if scenario == 'ship-merge':
            turns['turn-2'] = [done(handoff), *after]
    turns[f'turn-{len(turns) + 1}'] = merge_turn
    for name, rows in turns.items():
        (out / f'{name}.stdout').write_text(''.join(json.dumps(r) + '\n' for r in rows))
        (out / f'{name}.status.json').write_text(json.dumps({'exit': 0, 'seconds': 1}))
    files = sorted(live.TASK_FILES)
    (out / 'state-before.json').write_text(json.dumps({'feature_files': files, 'feature_tests_rc': 0, 'origin_main': 'b',
                                                       'pr_state': 'OPEN', 'summaries': list(records)}))
    (out / 'state-after.json').write_text(json.dumps({
        'head_branch': head_branch, 'head': 'm', 'origin_main': 'm', 'origin_main_files': files, 'main_tests_rc': 0,
        'origin_feature': None, 'branches': ['main'], 'summaries': [],
        'worktree_list': f'worktree {repo}\nHEAD m\nbranch refs/heads/main\n'}))
    (out / 'gh-state.json').write_text(json.dumps({'prs': [{'number': 1, 'headRefName': feature, 'baseRefName': 'main',
                                                            'state': 'MERGED'}]}))
    calls = [{'argv': ['pr', 'create'], 'exit': 0}] + ([{'argv': list(merge_argv), 'exit': 0}] if merge_argv else [])
    calls += [{'argv': ['pr', 'view', '1', '--json', 'state'], 'exit': 0}] if view else []
    (out / 'gh-calls.jsonl').write_text(''.join(json.dumps(c) + '\n' for c in calls))
    names = sorted(turns)
    (out / 'meta.json').write_text(json.dumps({'provider': 'claude', 'scenario': scenario, 'pkg': str(pkg),
                                               'repo': str(repo), 'cwd': str(cwd), 'base': 'b',
                                               'versions': {'orchestration': '4.23.0'}, 'turns': names,
                                               'merge_turn': names[-1], 'merge_turn_calls_from': 1,
                                               'driver_calls': [{'argv': ['pr', 'create']}] if not ship else [],
                                               **({'handoff_turn': 'turn-2'} if ship else {})}))
    return out


REPORT = 'Merged #1 and cleaned up.\n\nRemoved: feature/durations (local and origin), .worktrees/runs/wave-1.'
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT))
    ok &= check('a complete mm-merge run passes every check', all(checks.values()))
    if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT + '\n\nShould I also delete `thread/x`?',
                                   removed_feature=False, head_branch=live.FEATURE))
    failed = sorted(k for k, v in checks.items() if not v)
    expected = ['checkout_left_feature', 'feature_removed_by_script', 'no_question_after_merge']
    ok &= check('a question, a kept checkout and no scripted branch removal fail exactly their checks', failed == expected)
    if failed != expected: print(failed)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merged-worktree', REPORT, head_branch=''))
    ok &= check('mm-merged-worktree: a merge call by the session fails merge_by_session, a detached checkout passes',
                checks['merge_by_session'] is False and checks['checkout_left_feature'] is True)
with tempfile.TemporaryDirectory() as tmp:
    out = run_dir(tmp, 'mm-merged-worktree', REPORT, head_branch='', merge_argv=None)
    (out / 'state-before.json').write_text(json.dumps({**json.loads((out / 'state-before.json').read_text()),
                                                       'pr_state': 'MERGED'}))
    checks, _ = live.score(out)
    ok &= check('a complete mm-merged-worktree run passes every check', all(checks.values()))
    if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    checks, facts = live.score(run_dir(tmp, 'mm-merge', REPORT, view=False))
    ok &= check('a cleanup without confirming the merge fails exactly merge_confirmed_before_cleanup',
                sorted(k for k, v in checks.items() if not v) == ['merge_confirmed_before_cleanup'])
with tempfile.TemporaryDirectory() as tmp:
    checks, facts = live.score(run_dir(tmp, 'ship-merge', REPORT))
    ok &= check('a complete ship-merge run passes every check, the merge offer included',
                all(checks.values()) and 'handoff_offers_merge' in checks and not facts['blocked'])
    if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, handoff=f'Left behind: x\nAfter the merge: `{CMD}`\n\nShould I fix the nit first?'))
    ok &= check('a ship handoff whose last question is not about merging fails handoff_offers_merge and its last line',
                sorted(k for k, v in checks.items() if not v) == ['handoff_offers_merge', 'handoff_question_last'])

# The merge question is the handoff's last line, with nothing after it.
LAST_LINE = {
    'the question in bold': ('**Merge pull request #1 into `main` and clean up?**', True),
    'the question in its own paragraph after the command block':
        (f'Left behind: x\n\nAfter the merge:\n```sh\n{CMD}\n```\n\nMerge PR #1 into `main` and clean up?', True),
    'a choice after the question on its line': ('Merge PR #1 into `main` now? (yes/no)', False),
    'a reason on the next line': ('Merge PR #1?\nMerging needs your word.', False),
    'the command block after the question': (f'Merge PR #1?\n\nAfter the merge:\n```sh\n{CMD}\n```', False),
    'another question last': ('Merge PR #1?\n\nShould I also delete the plan file?', False),
}
for name, (text, want) in LAST_LINE.items():
    ok &= check(f'question_last {want}: {name}', live.question_last(text) is want)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT,
                                   handoff=f'Left behind: x\nAfter the merge: `{CMD}`\n\nMerge PR #1? (yes/no)\n\nIt needs your word.'))
    ok &= check('a ship handoff with text after its merge question fails exactly handoff_question_last',
                sorted(k for k, v in checks.items() if not v) == ['handoff_question_last'])

# ship-wave-merge: the start approval comes before the wave.
with tempfile.TemporaryDirectory() as tmp:
    checks, facts = live.score(run_dir(tmp, 'ship-wave-merge', REPORT))
    ok &= check('a complete ship-wave-merge run passes every check, the start approval included',
                all(checks.values()) and 'start_approval_before_wave' in checks and 'handoff_question_last' in checks)
    if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-wave-merge', REPORT, approval_runner=True))
    ok &= check('ship-wave-merge: a wave run in the first turn fails exactly start_approval_before_wave',
                sorted(k for k, v in checks.items() if not v) == ['start_approval_before_wave'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-wave-merge', REPORT, approval='Plan ready: one task, one wave.'))
    ok &= check('ship-wave-merge: a first turn that asks nothing fails exactly its two start checks',
                sorted(k for k, v in checks.items() if not v) == ['start_approval_before_wave', 'start_question_last'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-wave-merge', REPORT, approval=(
        'Plan ready.\n\nStart execution?\n\nThe [planning workflow](.agents/skills/super-plan/WORKFLOW.md) '
        'requires: “wait for the user\'s approval to start.”')))
    ok &= check('ship-wave-merge: a start approval citing the workflow after its question fails exactly '
                'start_question_last and no_instruction_file_named',
                sorted(k for k, v in checks.items() if not v) == ['no_instruction_file_named', 'start_question_last'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, summary='Plan ready.\n\nApprove the plan and start? (yes/no)'))
    ok &= check('ship-merge: a start approval with text after its question fails exactly start_question_last',
                sorted(k for k, v in checks.items() if not v) == ['start_question_last'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-wave-merge', REPORT, waved=False))
    ok &= check('ship-wave-merge: no wave after the approval fails start_approval_before_wave',
                checks['start_approval_before_wave'] is False)

# The After the merge: command, scored in every scenario.
RECORDS = ('.worktrees/runs/wave-1/summary.json',)
with tempfile.TemporaryDirectory() as tmp:
    checks, facts = live.score(run_dir(tmp, 'mm-merge', REPORT, summary=f'Left behind: x\n\nAfter the merge:\n```sh\n{CMD}\n```',
                                       records=RECORDS))
    ok &= check('mm-merge: the command written out in a block below, as printed, passes',
                checks['after_merge_written_out'] and checks['after_merge_as_printed'] and all(checks.values())
                and facts['after_merge_command'] == CMD)
    if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, records=RECORDS,
                                   summary="Left behind: x\n\nAfter the merge:\n```sh\nR='/x'\nnode \"$R/wave-cleanup.mjs\" "
                                           '--repo "$R/repo" --plan "$R/repo/p.md"\n```'))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('mm-merge: a command with a shell variable fails exactly the two command checks',
                failed == ['after_merge_as_printed', 'after_merge_written_out'])
    if failed != ['after_merge_as_printed', 'after_merge_written_out']: print(failed)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, printed=CMD.replace('--records ', '')))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('mm-merge: an absolute command the dry run did not print fails exactly after_merge_as_printed',
                failed == ['after_merge_as_printed'])
    if failed != ['after_merge_as_printed']: print(failed)
LINKED = ('Left behind: x\nAfter the merge: run the [prepared cleanup command](.worktrees/verification/after-merge.md).\n\n'
          'Merge PR #1?')
with tempfile.TemporaryDirectory() as tmp:
    checks, facts = live.score(run_dir(tmp, 'ship-merge', REPORT, handoff=LINKED, records=RECORDS))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('ship-merge: a handoff that links a file fails exactly the two command checks',
                failed == ['after_merge_as_printed', 'after_merge_written_out'])
    if failed != ['after_merge_as_printed', 'after_merge_written_out']: print(failed)
NO_PLAN = 'node /x/package/plugins/orchestration/skills/multi-model/references/wave-cleanup.mjs --repo /x/repo --into origin/main --records --branch add-parse-duration'
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, handoff=f'Left behind: x\nAfter the merge: `{NO_PLAN}`\n\nMerge PR #1?',
                                   printed=NO_PLAN, waved=False))
    ok &= check('ship-merge without a plan: the command with no --plan, as printed, passes',
                checks['after_merge_written_out'] and checks['after_merge_as_printed'] and all(checks.values()))
    if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    # turn 1 of ship is the start approval, with no After the merge: line
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, handoff='Left behind: x\n\nMerge PR #1?',
                                   summary='Plan ready.\n\nApprove the plan and start?'))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('ship-merge: a handoff with no After the merge: line fails exactly the two command checks',
                failed == ['after_merge_as_printed', 'after_merge_written_out'])
    if failed != ['after_merge_as_printed', 'after_merge_written_out']: print(failed)

FAKE = CMD.replace('/x/repo/docs/plan.md', '/x/repo/.git/ship-cleanup.md')
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, handoff=f'Left behind: x\nAfter the merge: `{FAKE}`\n\nMerge PR #1?',
                                   printed=FAKE, waved=False))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('ship-merge: a plan made up under .git, with no wave run, fails exactly after_merge_plans_from_run',
                failed == ['after_merge_plans_from_run'])
    if failed != ['after_merge_plans_from_run']: print(failed)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, waved=False))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('ship-merge: a --plan with no wave run fails exactly after_merge_plans_from_run',
                failed == ['after_merge_plans_from_run'])
    if failed != ['after_merge_plans_from_run']: print(failed)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, summary=f'Left behind: x\nAfter the merge: `{CMD}`\n\nStart?',
                                   handoff='Left behind: x\n\nMerge PR #1?'))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('ship-merge: an earlier turn\'s line does not stand in for a handoff without one',
                failed == ['after_merge_as_printed', 'after_merge_written_out'])
    if failed != ['after_merge_as_printed', 'after_merge_written_out']: print(failed)

def failed_of(checks):
    return sorted(k for k, v in checks.items() if not v)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, handoff=f'Left behind: x\nAfter the merge: `{FAKE}`\n\nMerge PR #1?',
                                   printed=FAKE, runner_plan='/x/repo/.git/ship-cleanup.md'))
    ok &= check('ship-merge: a plan under .git fails after_merge_plans_from_run even when a runner took it',
                failed_of(checks) == ['after_merge_plans_from_run'])
OTHER = CMD.replace('/x/repo/docs/plan.md', '/x/repo/docs/other.md')
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, summary=f'Left behind: x\nAfter the merge: `{OTHER}`', printed=OTHER))
    ok &= check('mm-merge: a --plan no runner call named fails exactly after_merge_plans_from_run',
                failed_of(checks) == ['after_merge_plans_from_run'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, summary=f'Left behind: x\nAfter the merge: `{OTHER}`', printed=OTHER,
                                   runner_plan='"$P"'))
    ok &= check('mm-merge: a runner given --plan through a variable lets any plan pass', all(checks.values()))
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, waved=False, extra=('grep -n status /p/wave-launch.mjs',)))
    ok &= check('mm-merge: reading a runner is not running a wave, so a --plan fails',
                failed_of(checks) == ['after_merge_plans_from_run'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, waved=False, records=RECORDS))
    ok &= check('mm-merge: a run record before the merge turn counts as a wave run', all(checks.values()))
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'ship-merge', REPORT, summary='Plan ready.\n\nApprove the plan and start?',
                                   handoff_after='The CI link is in the pull request.'))
    # (handoff_offers_merge reads the turn's last reply, by its own rule)
    ok &= check('ship-merge: a handoff turn with a second, shorter reply still scores the line of the handoff',
                checks['after_merge_written_out'] and checks['after_merge_as_printed']
                and checks['after_merge_plans_from_run'])
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'mm-merge', REPORT, extra=(
        "/bin/zsh -c 'node \"$(realpath .agents/skills/multi-model)/../../skills/multi-model/references/"
        "codex-wave-runner.mjs\" --plan docs/plan.md --wave 1'",)))
    ok &= check('a runner path quoted with $(realpath …) inside zsh -c is a runner call', all(checks.values()))
    _, facts = live.score(run_dir(tmp + '/q', 'mm-merge', REPORT, waved=False, extra=(
        "/bin/zsh -c 'node \"$(realpath .agents/skills/multi-model)/../../skills/multi-model/references/"
        "codex-wave-runner.mjs\" --plan docs/plan.md --wave 1'",)))
    ok &= check('… and counts once, with its --plan', facts['runner_calls'] == 1 and facts['runner_plans'] == ['docs/plan.md'])
    # Codex, live: a substitution with quotes of its own inside the quoted path.
    nested = ('/bin/zsh -c \'node "$(dirname "$(realpath .agents/skills/ship)")/../skills/multi-model/references/'
              'codex-wave-runner.mjs" --plan docs/plan.md --wave 1 --repo "$PWD"\'')
    ok &= check('a runner path with "$(dirname "$(realpath …)")" inside zsh -c is a runner call, with its --plan',
                live.runner_calls([nested]) == (1, ['docs/plan.md']))
    inside = ('/bin/zsh -c \'node "$(realpath .agents/skills/ship/../../skills/multi-model/references/codex-wave-runner.mjs)" '
              '--plan "$PWD/docs/plan.md" --wave 1 --repo "$PWD"\'')
    ok &= check('a runner path that ends inside "$(realpath …)" is a runner call, with its --plan',
                live.runner_calls([inside]) == (1, ['$PWD/docs/plan.md']))

# Instruction files named or linked in a message to the user.
codex_msg = lambda t: {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': t}}
NAMED = {
    'the merge question justified by a link (Codex, 4.23.1)':
        'Shall I merge PR #1?\n\nThe [delivery instructions](.agents/skills/ship/SKILL.md) require merging "only when the user asks for it."',
    'a skill linked by name (Codex, 4.23.0)': 'Merge PR #1? [ship](/x/.agents/skills/ship/SKILL.md) requires: "merge only when the user asks."',
    'the start approval citing the planning workflow':
        'Approve the plan to start? The [planning workflow](/x/skills-codex/super-plan/WORKFLOW.md) asks for it.',
    'a profile named in an update': 'Loaded orchestrator-fable-5-2.md; starting the wave.',
    'a reference document': 'Following references/codex-wave-protocol.md, the wave is merged.',
    'a workspace skill path': 'Read .agents/skills/multi-model before the run.',
    'critical-review\'s fix rules linked': 'Approve the fixes? [fix rules](/x/plugins/code-review/skills-codex/critical-review/FIXES.md)',
    'a bare reference document': 'The wave follows codex-wave-protocol.md.',
    'a reviewer profile': 'Routed to reviewer-gpt-6-1-sol.md for the review.',
    'a profile stem without .md': 'Selected orchestrator-fable-5-2 for this run.',
    'a link to a skill directory': 'Handled by [the delivery skill](/x/plugins/orchestration/skills-codex/ship).',
    'a file in inline code': 'Per `SKILL.md`, the merge waits for you.',
    'a file in a code block that is not the cleanup': 'See:\n```text\nWORKFLOW.md, Stage 4\n```',
    'a file name in lower case': 'As skill.md says, the merge waits for you.',
    'a link to a skill directory with an anchor': 'See [Stage 4](/x/plugins/orchestration/skills/ship/#stage-4).',
    'a file in the block that holds the command':
        'After the merge:\n```sh\n# WORKFLOW.md, Stage 4\n'
        'node /x/package/plugins/orchestration/skills/multi-model/references/wave-cleanup.mjs --repo /x\n```',
}
for name, text in NAMED.items():
    ok &= check(f'named: {name}', bool(live.instruction_files_named([codex_msg(text)])))
CLEAN = {
    'the command after the merge in a block':
        'After the merge:\n```sh\nnode /x/package/plugins/orchestration/skills/multi-model/references/wave-cleanup.mjs --repo /x\n```',
    'the command inline': 'After the merge: `node /x/.agents/skills/multi-model/../../skills/multi-model/references/wave-cleanup.mjs --repo /x`',
    'the command wrapped over lines in a block':
        'After the merge:\n```sh\nnode /x/.agents/skills/multi-model/references/wave-cleanup.mjs \\\n'
        '  --plan /x/.agents/skills/plan.md --repo /x\n```',
    'the plan, README and AGENTS.md': 'The plan docs/superpowers/plans/plan.md is done; README.md and AGENTS.md are unchanged.',
    'a plain merge question': 'Nothing is left open. Merge PR #1 into main and clean up?',
    'model and plan names': 'The gpt-6.1-sol review passed; docs/superpowers/plans/2026-11-11-parse-duration.md is done.',
}
for name, text in CLEAN.items():
    ok &= check(f'not named: {name}', not live.instruction_files_named([codex_msg(text)]))
claude_rows = [{'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'I will follow WORKFLOW.md now.'}]}},
               {'type': 'assistant', 'parent_tool_use_id': 'child', 'message': {'content': [{'type': 'text', 'text': 'SKILL.md says so'}]}}]
ok &= check('a Claude text block counts, a child agent\'s does not', live.instruction_files_named(claude_rows) == ['WORKFLOW.md'])
with tempfile.TemporaryDirectory() as tmp:
    checks, facts = live.score(run_dir(tmp, 'ship-merge', REPORT, summary='Plan ready.\n\nApprove the plan and start?',
                                       handoff=f'Left behind: x\nAfter the merge: `{CMD}`\n\n' + NAMED['the merge question justified by a link (Codex, 4.23.1)']))
    ok &= check('ship-merge: a handoff that links the skill file after its question fails exactly '
                'no_instruction_file_named and handoff_question_last',
                failed_of(checks) == ['handoff_question_last', 'no_instruction_file_named']
                and 'SKILL.md' in facts['instruction_files_named'])
    if failed_of(checks) != ['handoff_question_last', 'no_instruction_file_named']:
        print(failed_of(checks), facts['instruction_files_named'])

# A Claude skill load is a user text block, not a tool result.
with tempfile.TemporaryDirectory() as tmp:
    out = run_dir(tmp, 'mm-merge', REPORT)
    rows = [json.loads(l) for l in (out / 'turn-1.stdout').read_text().splitlines()]
    rows[1] = {'type': 'user', 'message': {'content': [{'type': 'text', 'text':
        'Base directory for this skill: /x/skills/multi-model\n\n# Multi-model\n... ' + live.FIX_MARK + ' ...'}]}}
    (out / 'turn-1.stdout').write_text(''.join(json.dumps(r) + '\n' for r in rows))
    checks, _ = live.score(out)
    ok &= check('instruction_read: the new text arriving as a Claude skill load counts', checks['instruction_read'])

sys.exit(0 if ok else 1)
