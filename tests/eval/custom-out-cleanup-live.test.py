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
ok &= check('inline handoff: Left behind section and the command up to the backtick',
            'runs/wave-1' in left and after.startswith('/p/wave-cleanup.mjs') and after.endswith(REC)
            and live.names_record(after) and '--records' in after)

left, after = live.handoff('Left behind:\n- branch feature/durations\n- .worktrees/runs/wave-1\n\nAfter the merge:\n'
                           '```bash\nnode /p/wave-cleanup.mjs --repo /x/repo \\\n  --records \\\n'
                           f'  --summary "{REC}" --branch feature/durations\n```\n')
ok &= check('fenced handoff: a continued command is read whole',
            'runs/wave-1' in left and live.names_record(after) and '--branch feature/durations' in after)

left, after = live.handoff('Left behind: nothing\n')
ok &= check('no After the merge line gives no command', after == '' and not live.names_record(after))

left, after = live.handoff('After the merge: `node /p/wave-cleanup.mjs --records --summary /x/repo/.worktrees/claude-runner/1-abc/summary.json`\n')
ok &= check('a default-directory summary is not the custom record', not live.names_record(after) and left == '')

cmds = [f'node /p/wave-cleanup.mjs --repo /x/repo --dry-run --records --summary {REC}',
        f"/bin/zsh -lc 'node /p/wave-cleanup.mjs --repo /x/repo --records --summary={REC}'",
        'node /p/wave-cleanup.mjs --repo /x/repo --records']
ok &= check('dry runs and real runs are told apart, quoted Codex commands included',
            live.cleanups(cmds, dry=True) == cmds[:1] and live.cleanups(cmds, dry=False) == cmds[1:2])

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / 'pkg'; refs = root / 'refs'; refs.mkdir(parents=True)
    (refs / 'wave-cleanup.mjs').write_text('')
    other = Path(tmp) / 'installed'; other.mkdir(); (other / 'wave-cleanup.mjs').write_text('')
    link = Path(tmp) / 'repo/.agents/skills'; link.mkdir(parents=True); (link / 'mm').symlink_to(refs)
    paths = live.script_paths([f'R={refs}; node "$R/wave-cleanup.mjs" --records',
                               'node .agents/skills/mm/wave-cleanup.mjs --dry-run',
                               'grep -n wave-cleanup.mjs WORKFLOW.md',
                               f'node {other}/wave-cleanup.mjs'])
    placed = [live.inside(p, root, Path(tmp) / 'repo') for p in paths]
    ok &= check('scripts run with node: variables expanded, links resolved, a mention ignored, '
                'an outside copy caught', placed == [True, True, False])
    ok &= check('a path that cannot be resolved is unknown', live.inside('/no/such/wave-cleanup.mjs', root, tmp) is None)

claude_rows = [{'type': 'result', 'result': 'Left behind: .worktrees/runs/wave-1\nAfter the merge: `node x/wave-cleanup.mjs`'},
               {'type': 'result', 'result': 'The background check finished.'}]
ok &= check('the handoff is taken from the result that carries it',
            live.handoff_reply(claude_rows).startswith('Left behind') and live.reply(claude_rows).startswith('The background'))


def run_dir(tmp, provider, handoff_text, cleanup_cmd, record_gone):
    out = Path(tmp) / provider; repo = out / 'repo'
    pkg = out / 'package'
    host = 'skills' if provider == 'claude' else 'skills-codex'
    wf = pkg / 'plugins/orchestration' / host / 'multi-model/WORKFLOW.md'
    wf.parent.mkdir(parents=True); wf.write_text('... ' + live.FIX_MARK + ' ...')
    refs = pkg / 'plugins/orchestration/skills/multi-model/references'; refs.mkdir(parents=True)
    (refs / 'wave-cleanup.mjs').write_text('')
    repo.mkdir(parents=True)
    rec = repo / live.RECORD
    script = refs / 'wave-cleanup.mjs'
    dry = f'node {script} --repo {repo} --dry-run --records --summary {rec}'
    real = cleanup_cmd.format(script=script, repo=repo, rec=rec)
    if provider == 'claude':
        init = {'type': 'system', 'subtype': 'init', 'plugins': [
            {'name': 'orchestration', 'path': str(pkg / 'plugins/orchestration'), 'version': '4.22.1'}]}
        bash = lambda c: {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': c}}]}}
        read = {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Read', 'input': {'file_path': str(wf)}}]}}
        t1 = [init, read, bash(dry), {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': handoff_text.format(rec=rec)}]
        t2 = [bash(real), {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'Cleaned up.'}]
    else:
        cmd = lambda c: {'type': 'item.completed', 'item': {'type': 'command_execution', 'command': f"/bin/zsh -lc '{c}'"}}
        msg = lambda t: {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': t}}
        link = repo / '.agents/skills'; link.mkdir(parents=True); (link / 'multi-model').symlink_to(wf.parent)
        t1 = [{'type': 'thread.started', 'thread_id': 't'}, cmd('sed -n 1,200p .agents/skills/multi-model/WORKFLOW.md'),
              cmd(dry), msg(handoff_text.format(rec=rec)), {'type': 'turn.completed', 'usage': {}}]
        t2 = [cmd(real), msg('Cleaned up.'), {'type': 'turn.completed', 'usage': {}}]
    for k, rows in ((1, t1), (2, t2)):
        (out / f'turn-{k}.stdout').write_text(''.join(json.dumps(r) + '\n' for r in rows))
        (out / f'turn-{k}.status.json').write_text(json.dumps({'exit': 0, 'seconds': 1}))
    s1 = {'record_summary': True, 'record_status': 'done' if provider == 'claude' else 'merge-ready',
          'accepted_status': 'done' if provider == 'claude' else 'merge-ready', 'record_tasks': [{'id': 'parse-duration'}],
          'feature_files': ['src/durations.py', 'tests/test_durations.py'], 'feature_tests_rc': 0, 'origin_main': 'b'}
    s2 = {'record_dir_exists': not record_gone, 'worktree_list': f'worktree {repo}\nHEAD b\nbranch refs/heads/main\n',
          'branches': ['main']}
    (out / 'state-1.json').write_text(json.dumps(s1)); (out / 'state-2.json').write_text(json.dumps(s2))
    (out / 'meta.json').write_text(json.dumps({'provider': provider, 'pkg': str(pkg), 'repo': str(repo), 'base': 'b',
                                               'versions': {'orchestration': '4.22.1'}}))
    return out


GOOD = 'Done.\nLeft behind: .worktrees/runs/wave-1\nAfter the merge: `node /p/wave-cleanup.mjs --records --summary {rec}`\n'
with tempfile.TemporaryDirectory() as tmp:
    for provider in ('claude', 'codex'):
        checks, _ = live.score(run_dir(tmp, provider, GOOD, 'node {script} --repo {repo} --records --summary {rec}', True))
        ok &= check(f'{provider}: a complete run passes every check', all(checks.values()))
        if not all(checks.values()): print(sorted(k for k, v in checks.items() if not v))
with tempfile.TemporaryDirectory() as tmp:
    bad = 'Done.\nLeft behind: .worktrees/runs (not recognized)\nAfter the merge: `node /p/wave-cleanup.mjs --records`\n'
    checks, _ = live.score(run_dir(tmp, 'claude', bad, 'node {script} --repo {repo} --records', False))
    failed = sorted(k for k, v in checks.items() if not v)
    ok &= check('the old handoff fails exactly the record checks',
                failed == ['after_merge_names_record', 'cleanup_ran_with_summary', 'left_behind_names_record',
                           'record_removed'])
raise SystemExit(0 if ok else 1)
