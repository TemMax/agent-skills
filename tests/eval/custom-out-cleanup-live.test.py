#!/usr/bin/env python3
"""Offline checks of custom-out-cleanup-live.py's trace reading and scoring."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('out_live', Path(__file__).with_name('custom-out-cleanup-live.py'))
live = importlib.util.module_from_spec(spec); spec.loader.exec_module(live)


def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    return cond


ok = True
REC = '/x/repo/.worktrees/runs/wave-1/summary.json'

left, after = live.handoff('Done.\n\n**Left behind:** `.worktrees/runs/wave-1` (run record)\n'
                           f'**After the merge:** `node /p/wave-cleanup.mjs --repo /x/repo --records --summary {REC}`\n')
ok &= check('inline handoff: the Left behind line and the command up to the backtick',
            'runs/wave-1' in left and after.startswith('/p/wave-cleanup.mjs') and after.endswith(REC)
            and live.names_record(after) and '--records' in after)

left, after = live.handoff('Left behind:\n\n- branch feature/durations\n- .worktrees/runs/wave-1\n\nAfter the merge:\n'
                           '```bash\nnode /p/wave-cleanup.mjs --repo /x/repo \\\n  --records \\\n'
                           f'  --summary "$repo/.worktrees/runs/wave-1/summary.json" --branch feature/durations\n```\n')
ok &= check('fenced handoff: a list after a blank line, and a continued command read whole',
            'runs/wave-1' in left and live.names_record(after) and '--branch feature/durations' in after)

left, after = live.handoff('Left behind: nothing.\n\nThe run record was .worktrees/runs/wave-1 before.\n')
ok &= check('the Left behind section ends at its paragraph', 'runs/wave-1' not in left and after == '')

left, after = live.handoff('After the merge: `node /p/wave-cleanup.mjs --records --summary '
                           '/x/repo/.worktrees/claude-runner/1-abc/summary.json`\n')
ok &= check('a default-directory summary is not the custom record', not live.names_record(after) and left == '')


def report(dry, *paths):
    return json.dumps({'into': 'abc', 'dryRun': dry, 'removed': [{'kind': 'record', 'path': p} for p in paths],
                       'kept': []}, indent=2)


RECORD_DIR = '/private/x/repo/.worktrees/runs/wave-1'
chained = f'== left\n{report(True, RECORD_DIR)}\n== cleanup\n{report(False, "/private/x/repo/.worktrees/claude-runner/1-a")}\n'
codex_rows = [{'type': 'item.completed', 'item': {'type': 'command_execution', 'command': 'x', 'aggregated_output': chained}}]
found = live.reports(codex_rows)
ok &= check('both reports of a chained dry run and real run are read, each on its own',
            [r['dryRun'] for r in found] == [True, False]
            and live.removes_record(found[0]) and not live.removes_record(found[1]))
claude_rows = [{'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': [
    {'type': 'text', 'text': 'Switched to main\n' + report(False, RECORD_DIR)}]}]}},
    {'type': 'user', 'parent_tool_use_id': 'child', 'message': {'content': [{'type': 'tool_result',
     'content': report(False, RECORD_DIR)}]}}]
found = live.reports(claude_rows)
ok &= check('a Claude tool result is read, a child agent\'s is not', len(found) == 1 and live.removes_record(found[0]))

hand = ['rm -rf .worktrees/runs/wave-1', "python3 -c 'import shutil; shutil.rmtree(\".worktrees/runs\")'",
        'find .worktrees -name x -delete', 'git -C /x/repo worktree remove .worktrees/wave-a', 'rm -rf .worktrees',
        'rmdir /x/repo/.worktrees/']
fine = ['rm -f /tmp/notes.txt', 'ls .worktrees', 'node /p/wave-cleanup.mjs --records --summary .worktrees/runs/wave-1/summary.json',
        'git worktree add --detach .worktrees/preflight HEAD && git worktree remove .worktrees/preflight']
ok &= check('removal by hand under .worktrees is caught, other commands are not',
            all(live.MANUAL.search(c) for c in hand) and not any(live.MANUAL.search(c) for c in fine))

result_rows = [{'type': 'result', 'result': 'Left behind: .worktrees/runs/wave-1\nAfter the merge: `node x/wave-cleanup.mjs`'},
               {'type': 'result', 'result': 'The background check finished.'}]
ok &= check('the handoff is taken from the result that carries it',
            live.handoff_reply(result_rows).startswith('Left behind') and live.reply(result_rows).startswith('The background'))


def run_dir(tmp, provider, handoff_text, read_text, dry_out, real_out, real_cmd, record_gone):
    out = Path(tmp) / provider; repo = out / 'repo'; pkg = out / 'package'
    host = 'skills' if provider == 'claude' else 'skills-codex'
    wf = pkg / 'plugins/orchestration' / host / 'multi-model'
    wf.mkdir(parents=True)
    repo.mkdir(parents=True)
    if provider == 'claude':
        init = {'type': 'system', 'subtype': 'init', 'plugins': [
            {'name': 'orchestration', 'path': str(pkg / 'plugins/orchestration'), 'version': '4.22.1'}]}
        bash = lambda c: {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': c}}]}}
        result = lambda t: {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': [{'type': 'text', 'text': t}]}]}}
        t1 = [init, result(read_text), bash('node c.mjs --dry-run --records --summary $S'), result(dry_out),
              {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': handoff_text}]
        t2 = [bash(real_cmd), result(real_out), {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'Cleaned up.'}]
    else:
        cmd = lambda c, o: {'type': 'item.completed', 'item': {'type': 'command_execution', 'command': f"/bin/zsh -lc '{c}'",
                                                                'aggregated_output': o, 'exit_code': 0}}
        msg = lambda t: {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': t}}
        link = repo / '.agents/skills'; link.mkdir(parents=True); (link / 'multi-model').symlink_to(wf)
        t1 = [{'type': 'thread.started', 'thread_id': 't'}, cmd('cat WORKFLOW.md', read_text),
              cmd('python3 run_dry.py', dry_out), msg(handoff_text), {'type': 'turn.completed', 'usage': {}}]
        t2 = [cmd(real_cmd, real_out), msg('Cleaned up.'), {'type': 'turn.completed', 'usage': {}}]
    for k, rows in ((1, t1), (2, t2)):
        (out / f'turn-{k}.stdout').write_text(''.join(json.dumps(r) + '\n' for r in rows))
        (out / f'turn-{k}.status.json').write_text(json.dumps({'exit': 0, 'seconds': 1}))
    accepted = 'done' if provider == 'claude' else 'merge-ready'
    s1 = {'record_summary': True, 'record_status': accepted, 'accepted_status': accepted,
          'record_tasks': [{'id': 'parse-duration'}], 'feature_files': ['src/durations.py', 'tests/test_durations.py'],
          'feature_tests_rc': 0, 'origin_main': 'b'}
    s2 = {'record_dir_exists': not record_gone, 'worktree_list': f'worktree {repo}\nHEAD b\nbranch refs/heads/main\n',
          'branches': ['main']}
    (out / 'state-1.json').write_text(json.dumps(s1)); (out / 'state-2.json').write_text(json.dumps(s2))
    (out / 'meta.json').write_text(json.dumps({'provider': provider, 'pkg': str(pkg), 'repo': str(repo), 'base': 'b',
                                               'versions': {'orchestration': '4.22.1'}}))
    return out


GOOD = 'Done.\nLeft behind: .worktrees/runs/wave-1\nAfter the merge: `node /p/wave-cleanup.mjs --records --summary ' + REC + '`\n'
READ_NEW = '... with `--summary <out>/summary.json` ' + live.FIX_MARK + ' outside ...'
with tempfile.TemporaryDirectory() as tmp:
    for provider in ('claude', 'codex'):
        checks, _ = live.score(run_dir(tmp, provider, GOOD, READ_NEW, report(True, RECORD_DIR), report(False, RECORD_DIR),
                                       'python3 cleanup.py', True))
        ok &= check(f'{provider}: a complete run passes every check', all(checks.values()))
        if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))

OLD_HANDOFF = 'Done.\nLeft behind: .worktrees/runs (not recognized)\nAfter the merge: `node /p/wave-cleanup.mjs --records`\n'
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'claude', OLD_HANDOFF, 'the old instruction', report(True), report(False),
                                   'node c.mjs --records', False))
    failed = sorted(k for k, v in checks.items() if not v)
    expected = ['after_merge_names_record', 'cleanup_removed_record', 'dry_run_lists_record',
                'instruction_read', 'left_behind_names_record', 'record_removed']
    ok &= check('the old instruction and script fail exactly the record checks', failed == expected)
    if failed != expected: print(failed)
with tempfile.TemporaryDirectory() as tmp:
    checks, _ = live.score(run_dir(tmp, 'codex', GOOD, READ_NEW, report(True, RECORD_DIR), report(False),
                                   'node c.mjs --records; rm -rf .worktrees/runs/wave-1', True))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('a record removed by hand after a cleanup that kept it fails',
                failed == ['cleanup_removed_record', 'no_removal_by_hand'])
    if failed != ['cleanup_removed_record', 'no_removal_by_hand']: print(failed)
raise SystemExit(0 if ok else 1)
