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
ok &= check('a merge question is a merge offer', live.offers_merge('PR #1 is ready.\n\nMerge it into `main` now?'))
ok &= check('another question is not a merge offer', not live.offers_merge('PR #1 is ready.\n\nShould I fix the nit?'))
ok &= check('a wrapped instruction read through Read still matches',
            live.FIX_MARK in live.flat('   301\tclean up at once too. The cleanup asks\n   302\tno question. Fetch'))

# Merge calls in the stub's log.
squash = {'argv': ['pr', 'merge', '1', '--squash'], 'exit': 0}
ok &= check('one successful squash merge passes', live.squash_merge_ok([squash]))
ok &= check('a refused --delete-branch before it still passes',
            live.squash_merge_ok([{'argv': ['pr', 'merge', '1', '--squash', '--delete-branch'], 'exit': 1}, squash]))
ok &= check('an --admin attempt fails', not live.squash_merge_ok([{'argv': ['pr', 'merge', '1', '--admin', '--squash'],
                                                                   'exit': 1}, squash]))
ok &= check('a merge commit is not a squash', not live.squash_merge_ok([{'argv': ['pr', 'merge', '1', '--merge'], 'exit': 0}]))
ok &= check('no merge fails', not live.squash_merge_ok([{'argv': ['pr', 'view', '1'], 'exit': 0}]))

# The cleanup report and branch removal by hand.
report = {'into': 'origin/main', 'dryRun': False, 'removed': [{'kind': 'branch', 'branch': 'feature/x', 'tip': 'abc'}]}
ok &= check('the feature branch in the removed list', live.removes_branch(report, 'feature/x'))
ok &= check('a task branch is not the feature branch',
            not live.removes_branch({'removed': [{'kind': 'branch', 'task': 'a', 'branch': 'feature/x'}]}, 'feature/x'))
hand = ['git branch -D feature/x', 'git -C /r branch -d feature/x', 'git update-ref -d refs/heads/feature/x']
fine = ['git push origin --delete feature/x', 'git branch --show-current', 'git branch -D wave/a']
ok &= check('deleting the feature branch by hand is caught, other commands are not',
            all(live.manual_branch_removal([c], 'feature/x') for c in hand)
            and not any(live.manual_branch_removal([c], 'feature/x') for c in fine))


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
               gh('pr', 'merge', '1', '--auto', '--squash'), gh('pr', 'merge', '1'), gh('pr', 'merge', '1', '--rebase'),
               gh('pr', 'merge', '1', '--squash', '--match-head-commit', '0' * 40)]
    ok &= check('stub: --admin, --delete-branch, --auto, no method, --rebase and a stale head are refused',
                all(r.returncode == 1 for r in refused) and bare('rev-parse', 'refs/heads/main') == main_before)
    merged = gh('pr', 'merge', '1', '--squash')
    head = bare('rev-parse', 'refs/heads/main')
    ok &= check('stub: a squash merge writes one commit on main with the feature tree',
                merged.returncode == 0 and 'Squashed and merged' in merged.stdout
                and bare('rev-parse', 'refs/heads/main^{tree}') == bare('rev-parse', 'refs/heads/feature/x^{tree}')
                and bare('rev-list', '--parents', '-n', '1', head).split()[1:] == [main_before]
                and bare('log', '-1', '--format=%s', head) == 'Add b (#1)')
    tree = bare('merge-tree', '--write-tree', 'refs/heads/main', 'refs/heads/feature/x')
    ok &= check('stub: the squashed feature branch reads as integrated (merge-tree gives main\'s tree)',
                tree == bare('rev-parse', 'refs/heads/main^{tree}'))
    view = json.loads(gh('pr', 'view', '1', '--json', 'state,merged,mergeCommit').stdout)
    ok &= check('stub: the pull request reads as merged', view['state'] == 'MERGED' and view['merged'] is True
                and view['mergeCommit']['oid'] == head)
    ok &= check('stub: a second merge is refused', gh('pr', 'merge', '1', '--squash').returncode == 1)
    run(['git', 'push', '-q', 'origin', '--delete', 'feature/x'], work, git_env)
    files = json.loads(gh('pr', 'view', '1', '--json', 'files,state').stdout)
    ok &= check('stub: a merged pull request still reads after its branch is deleted',
                files['state'] == 'MERGED' and [f['path'] for f in files['files']] == ['b.txt'])
    calls = [json.loads(line) for line in (tmp / 'calls.jsonl').read_text().splitlines()]
    ok &= check('stub: every call is logged', len(calls) == 12 and calls[0]['argv'][:2] == ['pr', 'create'])


# score() on a synthetic run directory.
def run_dir(tmp, scenario, final, merge_argv=('pr', 'merge', '1', '--squash'), removed_feature=True, head_branch='main'):
    out = Path(tmp) / scenario; pkg = out / 'package'; repo = out / 'repo'; cwd = repo
    (pkg / 'plugins/orchestration').mkdir(parents=True); repo.mkdir(parents=True)
    feature = live.FEATURE
    init = {'type': 'system', 'subtype': 'init',
            'plugins': [{'name': 'orchestration', 'path': str(pkg / 'plugins/orchestration'), 'version': '4.23.0'}]}
    bash = lambda c: {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': c}}]}}
    result = lambda t: {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': [{'type': 'text', 'text': t}]}]}}
    done = lambda t: {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': t}
    rep = {'into': 'origin/main', 'dryRun': False, 'kept': [],
           'removed': ([{'kind': 'branch', 'branch': feature, 'tip': 'f'}] if removed_feature else [])
           + [{'kind': 'record', 'path': str(repo / '.worktrees/runs/wave-1')}]}
    turns = {'turn-1': [init, result('   1\tThe cleanup asks\n   2\tno question.'), done('Left behind: x\nAfter the merge: y')],
             'turn-2': [bash('gh pr merge 1 --squash'), bash('node /p/wave-cleanup.mjs --records --branch ' + feature),
                        result(json.dumps(rep)), done(final)]}
    for name, rows in turns.items():
        (out / f'{name}.stdout').write_text(''.join(json.dumps(r) + '\n' for r in rows))
        (out / f'{name}.status.json').write_text(json.dumps({'exit': 0, 'seconds': 1}))
    files = sorted(live.TASK_FILES)
    (out / 'state-before.json').write_text(json.dumps({'feature_files': files, 'feature_tests_rc': 0, 'origin_main': 'b',
                                                       'pr_state': 'OPEN'}))
    (out / 'state-after.json').write_text(json.dumps({
        'head_branch': head_branch, 'head': 'm', 'origin_main': 'm', 'origin_main_files': files, 'main_tests_rc': 0,
        'origin_feature': None, 'branches': ['main'], 'summaries': [],
        'worktree_list': f'worktree {repo}\nHEAD m\nbranch refs/heads/main\n'}))
    (out / 'gh-state.json').write_text(json.dumps({'prs': [{'number': 1, 'headRefName': feature, 'baseRefName': 'main',
                                                            'state': 'MERGED'}]}))
    (out / 'gh-calls.jsonl').write_text(json.dumps({'argv': ['pr', 'create'], 'exit': 0}) + '\n'
                                        + json.dumps({'argv': list(merge_argv), 'exit': 0}) + '\n')
    (out / 'meta.json').write_text(json.dumps({'provider': 'claude', 'scenario': scenario, 'pkg': str(pkg),
                                               'repo': str(repo), 'cwd': str(cwd), 'base': 'b',
                                               'versions': {'orchestration': '4.23.0'}, 'turns': ['turn-1', 'turn-2'],
                                               'merge_turn': 'turn-2', 'merge_turn_calls_from': 1}))
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

sys.exit(0 if ok else 1)
