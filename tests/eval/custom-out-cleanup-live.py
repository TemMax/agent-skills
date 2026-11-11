#!/usr/bin/env python3
"""Live cleanup of a run record kept under a custom runner `--out`, on either host.

Turn 1: the session runs multi-model on a one-task approved plan (the
duration-parsing plan of fable-seat-live.py, with Codex models on Codex) and
gives the runner `--out <repo>/.worktrees/runs/wave-1`. It integrates the wave
into `feature/durations` and pushes that branch to a local bare `origin`.
With `--wave-by driver` the driver runs the shipped runner with that `--out`
first, and the session finishes the run: integration, verification, push and
the handoff. The driver then fast-forwards origin's `main` to the branch, as a
merge would. Turn 2 resumes the session with the user's word that the branch
is merged; the documented answer is to run the `After the merge:` command.

The candidate is loaded disposably. Claude uses a `--plugin-dir` snapshot with
`--setting-sources project`. Codex uses workspace skills linked to the
snapshot, `--ignore-user-config` and `--disable plugins`. A Codex session that
launches the runner runs outside the sandbox, as in ship-smoke (macOS seatbelt
cannot nest; the runner sandboxes its children). With `--wave-by driver` it
runs in `workspace-write`, writable roots limited to the repository, its
`.git` and `origin`. Runner children use the normal CLI configuration. GitHub
credentials are removed from the environment, and `origin` is local.

The cleanup is judged by what wave-cleanup.mjs itself reported in the
session's tool output (its JSON `removed` list), not by the command text: only
the candidate script can remove a record outside the default directories.
The turn-1 reply's `After the merge:` line must hold the cleanup command
itself, written out, word for word as a `--dry-run` report printed it.
Expectations are frozen in expected.json before the host starts. The state
after each turn is saved to state-1.json and state-2.json. checks.json is
computed from those files and the traces; `--score DIR` recomputes it.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
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
seat = load('seat_live', 'fable-seat-live.py')
OUT_REL = '.worktrees/runs/wave-1'
RECORD = OUT_REL + '/summary.json'
FEATURE = 'feature/durations'
FIX_MARK = 'Take that command from the `command` field that'
SEAT = {'claude': 'claude-fable-5-2', 'codex': 'gpt-6.1-sol'}
SCRIPTS = ('wave-cleanup.mjs', 'claude-wave-runner.mjs', 'codex-wave-runner.mjs', 'wave-launch.mjs')
PROMPT_2 = f'`{FEATURE}` is merged into `main` on `origin`.\n'
# The frozen wording of the two After the merge: checks, shared with
# merge-cleanup-live.py.
AFTER_MERGE_WRITTEN_OUT = ("{reply}: an After the merge: line holds the cleanup command itself — in an inline "
                           "code span of that line naming wave-cleanup.mjs, in the rest of the line, or in a logical "
                           "line of the code block right below it, from node on; any such line of the reply counts: "
                           "the cleanup script and every --repo, --plan and --summary path absolute, --repo present, "
                           "no --dry-run or --help, and no $ or backtick outside single quotes (no shell variable or "
                           "command substitution); a link or a file in its place fails")
AFTER_MERGE_AS_PRINTED = ("a command on that line is, word for word (shell words), the command field of a "
                          "wave-cleanup.mjs --dry-run report in {turn}")
# Removing by hand what the cleanup script owns: .worktrees itself, a run
# record, a task worktree, the state or log directories. A scratch checkout
# the session made and removed itself is not counted.
OWNED = r'\.worktrees(?:/(?:runs|wave-|claude-runner|codex-runner|codex-wave|verification-logs)|/?(?=[\s\'"`)]|$))'
MANUAL = re.compile(r'(?:\brm\b|\brmdir\b|rmtree|os\.remove|os\.rmdir|\bunlink\b|'
                    r'git\s+(?:-C\s+\S+\s+)?worktree\s+remove)[^\n;&|]*' + OWNED
                    + r'|\bfind\b[^\n;&|]*' + OWNED + r'[^\n;&|]*-delete')


def plan_text(provider):
    if provider == 'claude':
        return seat.PLAN
    return seat.PLAN.replace('claude-sonnet-5-5', 'gpt-6.1-sol').replace('claude-haiku-5-5', 'gpt-6-luna')


def prompt_1(provider, repo, wave_by):
    skill = 'orchestration:multi-model' if provider == 'claude' else '$multi-model'
    finish = (f'Integrate the result into `{FEATURE}`, verify it there and push that branch to `origin`, '
              'a local bare repository. Do not open a pull request and do not merge into `main`; the user '
              f'merges `{FEATURE}` later. Finish the run.\n')
    if wave_by == 'session':
        text = (f'Use {skill} to execute the approved plan at {seat.PLAN_REL} in this repository. The user '
                'gave the start approval (Gate 2) for this plan as written; no user can answer questions '
                f'during this run. Create the branch `{FEATURE}` from `main` and run the wave with the '
                f'runner given `--out {repo / OUT_REL}`. ' + finish)
        if provider == 'codex':
            text += 'This session runs outside a sandbox; the runner sandboxes each child it starts.\n'
        return text
    text = (f'Use {skill} to finish the approved plan at {seat.PLAN_REL} in this repository. The user gave '
            'the start approval (Gate 2) for this plan as written; no user can answer questions during '
            'this run. Its wave has already run: the shipped runner was launched with '
            f'`--out {repo / OUT_REL}` and finished; its summary is `{repo / RECORD}`. Create the branch '
            f'`{FEATURE}` from `main`. ' + finish)
    if provider == 'codex':
        text += ('This session runs in a sandbox that can write to the repository, its `.git` and `origin`; '
                 'commits are not signed here (`commit.gpgsign` is false), so no command needs to run '
                 'outside the sandbox.\n')
    return text


def command(provider, turn, sid, repo, out, pkg, model, effort, budget, wave_by='session'):
    if provider == 'claude':
        cmd = [shutil.which('claude'), '-p', '--verbose', '--output-format', 'stream-json',
               '--model', model, '--effort', effort,
               '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
               '--allowedTools', 'Read,Glob,Grep,Bash,Skill,Write,Edit,Agent',
               '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
               '--add-dir', str(pkg), '--plugin-dir', str(pkg / 'plugins/orchestration'),
               '--max-budget-usd', str(budget)]
        return cmd + (['--session-id', sid] if turn == 1 else ['--resume', sid])
    common = ['--ignore-user-config', '--disable', 'plugins', '--json', '--skip-git-repo-check',
              '--model', model, '-c', f'model_reasoning_effort="{effort}"',
              '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false']
    if wave_by == 'session':
        if turn == 1:
            return [shutil.which('codex'), 'exec', *common, '-C', str(repo), '--sandbox', 'danger-full-access', '-']
        return [shutil.which('codex'), 'exec', 'resume', *common, '-c', 'sandbox_mode="danger-full-access"', sid, '-']
    roots = [str(repo / '.git'), str(out / 'origin.git')]
    sandbox = ['-c', 'sandbox_mode="workspace-write"',
               '-c', 'sandbox_workspace_write.writable_roots=' + json.dumps(roots)]
    if turn == 1:
        return [shutil.which('codex'), 'exec', *common, *sandbox, '-C', str(repo), '--sandbox', 'workspace-write',
                *[a for r in roots for a in ('--add-dir', r)], '-']
    return [shutil.which('codex'), 'exec', 'resume', *common, *sandbox, sid, '-']


def isolate(out):
    """No GitHub credentials or prompts reach the session; `origin` is a local path."""
    empty = out / 'gh-config'; empty.mkdir()
    for name in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'SSH_AUTH_SOCK'):
        os.environ.pop(name, None)
    os.environ.update(GH_CONFIG_DIR=str(empty), GIT_TERMINAL_PROMPT='0')


# Trace reading. Claude: stream-json rows; Codex: `exec --json` items.
def flat(text):
    """Tool output with Read-style line-number prefixes removed and whitespace
    collapsed, so a phrase wrapped across lines still matches."""
    return re.sub(r'\s+', ' ', re.sub(r'(?m)^[ \t]*\d+(?:\t|→)', '', text or ''))


def commands(rows):
    found = []
    for r in rows:
        item = r.get('item') or {}
        if r.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            found.append(item.get('command') or '')
        if r.get('type') == 'assistant' and not r.get('parent_tool_use_id'):
            for b in (r.get('message') or {}).get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'Bash':
                    found.append((b.get('input') or {}).get('command') or '')
    return found


def outputs(rows):
    """What the main session's tools returned, in order: Codex command output,
    Claude tool results (file reads and command output alike)."""
    found = []
    for r in rows:
        item = r.get('item') or {}
        if r.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            found.append(item.get('aggregated_output') or '')
        if r.get('type') == 'user' and not r.get('parent_tool_use_id'):
            content = (r.get('message') or {}).get('content')
            for b in content if isinstance(content, list) else []:
                if isinstance(b, dict) and b.get('type') == 'tool_result':
                    c = b.get('content')
                    found.append(c if isinstance(c, str) else ''.join(
                        x.get('text') or '' for x in c or [] if isinstance(x, dict)))
    return found


def reports(rows):
    """The JSON reports wave-cleanup.mjs printed, wherever they sit in the output."""
    found, decoder = [], json.JSONDecoder()
    for text in outputs(rows):
        for m in re.finditer(r'\{\s*"into"', text):
            try:
                obj, _ = decoder.raw_decode(text, m.start())
            except ValueError:
                continue
            if isinstance(obj, dict) and isinstance(obj.get('removed'), list) and 'dryRun' in obj:
                found.append(obj)
    return found


def removes_record(report):
    return any(isinstance(item, dict) and item.get('kind') == 'record'
               and str(item.get('path', '')).rstrip('/').endswith('/' + OUT_REL) for item in report['removed'])


def replies(rows):
    """Every final message of the invocation, in order: Codex agent messages, or
    Claude results (a background task can end an invocation with a second one)."""
    texts = [(r.get('item') or {}).get('text') or '' for r in rows
             if r.get('type') == 'item.completed' and (r.get('item') or {}).get('type') == 'agent_message']
    return texts or [r.get('result') or '' for r in rows if r.get('type') == 'result']


def reply(rows):
    return (replies(rows) or [''])[-1]


def handoff_reply(rows):
    """The last final message that carries the handoff, else the last one."""
    found = [t for t in replies(rows) if re.search(MARK.format('left behind'), t)]
    return found[-1] if found else reply(rows)


def complete(rows, rc):
    if any(str(r.get('type')).startswith(('thread.', 'turn.', 'item.')) for r in rows):
        return rc == 0 and any(r.get('type') == 'turn.completed' for r in rows)
    res = final_result(rows)
    return rc == 0 and res.get('subtype') == 'success' and not res.get('is_error')


def session_id(rows, sid):
    return next((r['thread_id'] for r in rows if r.get('type') == 'thread.started'), sid)


def init_plugins(rows):
    init = next((r for r in rows if r.get('type') == 'system' and r.get('subtype') == 'init'), {})
    return init.get('plugins') or []


# Reply and command parsing.
MARK = r'(?im)^[ \t>*_#-]*{}\b'


def handoff(text):
    """The `Left behind:` section (up to `After the merge:`) and the After-the-merge command."""
    left = re.search(MARK.format('left behind'), text)
    after = re.search(MARK.format('after the merge'), text)
    left_text = ''
    if left:
        # The marker's paragraph or list: up to a blank line or the After-the-merge line.
        end = after.start() if after and after.start() > left.end() else len(text)
        seg = text[left.end():end]
        lead = len(seg) - len(seg.lstrip(':*_ \t\n'))
        blank = re.search(r'\n[ \t]*\n', seg[lead:])
        left_text = seg[:lead + blank.start()] if blank else seg
    cmd = ''
    if after:
        rest = text[after.end():]
        m = re.search(r'[^\s`]*wave-cleanup\.mjs', rest)
        if m:
            cmd = re.split(r'(?<!\\)\n|`', rest[m.start():], maxsplit=1)[0]
    return left_text, cmd


def after_merge_commands(text):
    """Every command an `After the merge:` line carries, from `node` on, in
    order: in each inline code span of the line that names the script, in the
    rest of the line, and in each logical line (backslash continuations
    joined) of the code block right below it. Every such line of the reply
    counts, so prose that starts with "After the merge" does not hide the real
    one."""
    found = []
    for m in re.finditer(MARK.format('after the merge'), text):
        line, _, below = text[m.end():].partition('\n')
        parts = [s for s in re.findall(r'`([^`\n]+)`', line) if 'wave-cleanup.mjs' in s] + [line]
        block = re.match(r'(?:[ \t]*\n)?[ \t]*(`{3,}|~{3,})[^\n]*\n(.*?)\n[ \t]*\1', below, re.S)
        if block:
            parts += re.split(r'(?<!\\)\n', block.group(2))
        for part in parts:
            for node in re.finditer(r'(?<![\w/.-])node\s', part):
                cmd = part[node.start():].strip()
                if 'wave-cleanup.mjs' in cmd and cmd not in found:
                    found.append(cmd)
    return found


def command_words(cmd):
    try:
        return shlex.split(cmd.replace('\\\n', ' '))
    except ValueError:
        return None


def expands(cmd):
    """A `$` or a backtick the shell would expand: anywhere outside single quotes."""
    single = double = escaped = False
    for ch in cmd:
        if escaped:
            escaped = False
        elif ch == '\\' and not single:
            escaped = True
        elif ch == "'" and not double:
            single = not single
        elif ch == '"' and not single:
            double = not double
        elif ch in '$`' and not single:
            return True
    return False


def written_out(cmd):
    """The command is the cleanup itself and runs as it is from any directory:
    `node`, the cleanup script and every --repo, --plan and --summary path
    absolute, --repo present, no --dry-run or --help, and nothing the shell
    would expand (a variable or a command substitution)."""
    words = command_words(cmd) if cmd and not expands(cmd) else None
    if not words or len(words) < 2 or words[0] != 'node' or not words[1].startswith('/') \
            or not words[1].endswith('/wave-cleanup.mjs') or '--repo' not in words \
            or '--dry-run' in words or '--help' in words:
        return False
    values = [words[i + 1] if i + 1 < len(words) else '' for i, w in enumerate(words) if w in ('--repo', '--plan', '--summary')]
    return all(v.startswith('/') for v in values)


def printed_commands(rows):
    return [command_words(r['command']) for r in reports(rows)
            if r.get('dryRun') is True and isinstance(r.get('command'), str)]


def after_merge_written(text):
    """The first command on an `After the merge:` line that is written out, or ''."""
    return next((c for c in after_merge_commands(text) if written_out(c)), '')


def as_printed(text, rows):
    """A command on an `After the merge:` line is, word for word, the `command`
    a dry run printed in these rows."""
    printed = [w for w in printed_commands(rows) if w]
    return any(command_words(c) in printed for c in after_merge_commands(text))


def summary_args(cmd):
    return [t.strip('\'"') for t in re.findall(r'--summary(?:=|\s+)(\S+)', cmd.replace('\\\n', ' '))]


def names_record(cmd):
    return any(t.rstrip('/').endswith(RECORD) for t in summary_args(cmd))


def expand(token, cmd):
    """Substitute `NAME=value` assignments made earlier in the same command."""
    values = {m.group(1): m.group(3) for m in re.finditer(r'\b([A-Za-z_]\w*)=([\'"]?)([^\s\'";&|]+)\2', cmd)}
    return re.sub(r'\$\{?([A-Za-z_]\w*)\}?', lambda m: values.get(m.group(1), m.group(0)), token)


def script_paths(cmds):
    """Scripts the session ran with `node`: the runners, the launcher, the cleanup."""
    names = '|'.join(re.escape(s) for s in SCRIPTS)
    return [expand(m.group(2), c) for c in cmds
            for m in re.finditer(rf'\bnode\s+([\'"]?)([^\s\'";|&()<>`]*(?:{names}))\1', c)]


# Repository state.
def origin_git(origin, *args):
    r = subprocess.run(['git', '--git-dir', str(origin), *args], capture_output=True, text=True, timeout=30)
    return r.stdout.strip() if r.returncode == 0 else None


def listing(path):
    return sorted(str(p.relative_to(path)) for p in path.rglob('*')) if path.is_dir() else None


def state_1(out, repo, origin, provider):
    summary = repo / RECORD
    data = json.loads(summary.read_text()) if summary.is_file() else {}
    tip = origin_git(origin, 'rev-parse', '--verify', 'refs/heads/' + FEATURE)
    files, tests_rc = [], None
    if tip:
        files = (origin_git(origin, 'ls-tree', '-r', '--name-only', tip) or '').split()
        clone = out / 'feature-clone'
        bench.call(['git', 'clone', '-q', '-b', FEATURE, str(origin), str(clone)])
        t = subprocess.run(seat.TESTS, cwd=clone, capture_output=True, text=True)
        (out / 'feature-tests.txt').write_text(t.stdout + t.stderr)
        tests_rc = t.returncode
    return {'record_summary': summary.is_file(), 'record_status': data.get('status'),
            'record_tasks': [{'id': t.get('id'), 'status': t.get('status')} for t in data.get('tasks') or []],
            'accepted_status': 'done' if provider == 'claude' else 'merge-ready',
            'worktrees_dir': listing(repo / '.worktrees'),
            'origin_main': origin_git(origin, 'rev-parse', 'refs/heads/main'), 'origin_feature': tip,
            'feature_files': files, 'feature_tests_rc': tests_rc,
            'worktree_list': bench.git(repo, 'worktree', 'list', '--porcelain'),
            'branches': bench.git(repo, 'branch', '--format=%(refname:short)').split(),
            'head_branch': bench.git(repo, 'branch', '--show-current')}


def merge(origin, base):
    main, tip = origin_git(origin, 'rev-parse', 'refs/heads/main'), origin_git(origin, 'rev-parse', '--verify', 'refs/heads/' + FEATURE)
    ok = bool(tip) and main == base and subprocess.run(
        ['git', '--git-dir', str(origin), 'merge-base', '--is-ancestor', main, tip]).returncode == 0
    if ok:
        bench.call(['git', '--git-dir', str(origin), 'update-ref', 'refs/heads/main', tip, main])
    return {'merged': ok, 'main_before': main, 'feature_tip': tip}


def state_2(repo, origin):
    return {'record_dir_exists': (repo / OUT_REL).exists(), 'worktrees_dir': listing(repo / '.worktrees'),
            'worktree_list': bench.git(repo, 'worktree', 'list', '--porcelain'),
            'branches': bench.git(repo, 'branch', '--format=%(refname:short)').split(),
            'head_branch': bench.git(repo, 'branch', '--show-current'), 'head': bench.git(repo, 'rev-parse', 'HEAD'),
            'origin_main': origin_git(origin, 'rev-parse', 'refs/heads/main'),
            'origin_feature': origin_git(origin, 'rev-parse', '--verify', 'refs/heads/' + FEATURE)}


def score(out):
    meta = json.loads((out / 'meta.json').read_text())
    provider, pkg, repo = meta['provider'], Path(meta['pkg']), Path(meta['repo'])
    rows1 = read_events(out / 'turn-1.stdout') if (out / 'turn-1.stdout').exists() else []
    rows2 = read_events(out / 'turn-2.stdout') if (out / 'turn-2.stdout').exists() else []
    s1 = json.loads((out / 'state-1.json').read_text()) if (out / 'state-1.json').exists() else {}
    s2 = json.loads((out / 'state-2.json').read_text()) if (out / 'state-2.json').exists() else {}
    status = {k: json.loads((out / f'turn-{k}.status.json').read_text())['exit']
              for k in (1, 2) if (out / f'turn-{k}.status.json').exists()}
    c1, c2 = commands(rows1), commands(rows2)
    r1, r2 = reports(rows1), reports(rows2)
    left, after = handoff(handoff_reply(rows1))
    turn_1 = handoff_reply(rows1)
    if provider == 'claude':
        plugin = next((p for p in init_plugins(rows1) if p.get('name') == 'orchestration'), {})
        loaded = plugin.get('path') == str(pkg / 'plugins/orchestration') and plugin.get('version') == meta['versions']['orchestration']
    else:
        link = repo / '.agents/skills/multi-model'
        loaded = os.path.realpath(link).startswith(os.path.realpath(pkg) + os.sep)
    checks = {
        'candidate_loaded': loaded,
        'instruction_read': any(FIX_MARK in flat(t) for t in outputs(rows1)),
        'turn_1_complete': complete(rows1, status.get(1)),
        'record_under_out': bool(s1.get('record_summary')),
        'wave_accepted': s1.get('record_status') == s1.get('accepted_status') and bool(s1.get('record_tasks')),
        'feature_pushed_and_green': {'src/durations.py', 'tests/test_durations.py'} <= set(s1.get('feature_files') or [])
                                    and s1.get('feature_tests_rc') == 0 and s1.get('origin_main') == meta['base'],
        'dry_run_lists_record': any(r['dryRun'] is True and removes_record(r) for r in r1),
        'left_behind_names_record': 'runs/wave-1' in left,
        'after_merge_names_record': '--records' in after and names_record(after),
        'after_merge_written_out': bool(after_merge_written(turn_1)),
        'after_merge_as_printed': as_printed(turn_1, rows1),
        'turn_2_complete': complete(rows2, status.get(2)),
        'cleanup_removed_record': any(r['dryRun'] is False and removes_record(r) for r in r2),
        'record_removed': s2.get('record_dir_exists') is False,
        'no_wave_worktree_or_branch': bool(s2) and sum(line.startswith('worktree ') for line in
                                                     s2.get('worktree_list', '').splitlines()) == 1
                                      and not any(b.startswith('wave/') for b in s2.get('branches') or []),
        'no_removal_by_hand': not any(MANUAL.search(c) for c in c1 + c2),
    }
    facts = {'script_paths': script_paths(c1 + c2), 'reports_turn_1': r1, 'reports_turn_2': r2,
             'after_merge_command': after, 'after_merge_absolute_summary': [t.startswith('/') for t in summary_args(after)],
             'after_merge_written': after_merge_written(turn_1), 'after_merge_commands': after_merge_commands(turn_1),
             'printed_commands': [' '.join(w) for w in printed_commands(rows1) if w],
             'after_merge_branch': f'--branch {FEATURE}' in after, 'after_merge_into': '--into origin/main' in after,
             'removals_by_hand': [c for c in c1 + c2 if MANUAL.search(c)],
             'left_behind': left.strip(), 'reply_2': reply(rows2),
             'local_feature_after': FEATURE in (s2.get('branches') or []), 'origin_feature_after': s2.get('origin_feature'),
             'worktrees_dir_after': s2.get('worktrees_dir'), 'head_branch_after': s2.get('head_branch')}
    bench.dump(out / 'checks.json', {'checks': checks, 'facts': facts})
    return checks, facts


def spend(out, provider):
    turns, last = {}, 0.0
    for k in (1, 2):
        path = out / f'turn-{k}.stdout'
        if not path.exists():
            continue
        rows = read_events(path)
        seconds = json.loads((out / f'turn-{k}.status.json').read_text())['seconds']
        if provider == 'claude':
            totals = [r.get('total_cost_usd') for r in rows if r.get('type') == 'result' and r.get('total_cost_usd') is not None]
            # A resumed headless session reports a cumulative total.
            cost = round(totals[-1] - last, 4) if totals else None
            last = totals[-1] if totals else last
            turns[k] = {'usd': cost, 'seconds': round(seconds), 'usage': usage(rows),
                        'turns': sum(r.get('num_turns') or 0 for r in rows if r.get('type') == 'result')}
        else:
            done = [r.get('usage') for r in rows if r.get('type') == 'turn.completed']
            turns[k] = {'seconds': round(seconds), 'usage': done[-1] if done else None}
    return turns


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', choices=['claude', 'codex'])
    p.add_argument('--model')
    p.add_argument('--wave-by', choices=['session', 'driver'], default='session',
                   help='Who runs the wave: the session (default) or the driver, before the session')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=6, help='Claude: cap per invocation')
    p.add_argument('--timeout', type=int, default=2400, help='Seconds for turn 1; turn 2 gets 900')
    p.add_argument('--out', type=Path)
    p.add_argument('--score', type=Path, help='Recompute checks.json of a retained run directory')
    p.add_argument('--prepare-only', action='store_true', help='Build and lint the fixture; no model call')
    args = p.parse_args()
    if args.score:
        checks, facts = score(args.score.resolve())
        print(json.dumps({'checks': checks, 'facts': facts}, ensure_ascii=False, indent=1))
        return 0 if all(checks.values()) else 1
    if not args.provider or not args.out: p.error('--provider and --out are required')
    out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    model = args.model or SEAT[args.provider]
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, 'new', 'HEAD')
    repo, _ = plan_live.fixture(out, 'interfaces')
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', '-b', 'main', str(origin)])
    bench.git(repo, 'remote', 'add', 'origin', str(origin))
    plan = repo / seat.PLAN_REL; plan.parent.mkdir(parents=True)
    plan.write_text(plan_text(args.provider))
    bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-m', 'Approved wave plan')
    lint = subprocess.run(['node', str(pkg / seat.LINT), str(plan), '--repo', str(repo)], capture_output=True, text=True)
    (out / 'lint-before.txt').write_text(lint.stdout + lint.stderr)
    if lint.returncode:
        raise SystemExit('fixture plan is not lint-clean:\n' + lint.stdout + lint.stderr)
    bench.git(repo, 'push', '-q', '-u', 'origin', 'main')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    if args.provider == 'codex':
        plan_live.register(repo, pkg)
        with (repo / '.git/info/exclude').open('a') as f:
            f.write('\n.agents/\n')
    bench.dump(out / 'expected.json', {
        'provider': args.provider, 'seat_model': model, 'effort': args.effort, 'wave_by': args.wave_by,
        'candidate_loaded': 'claude: the init event lists the snapshot plugin and version; codex: the '
                            'workspace skill resolves into the snapshot',
        'instruction_read': f'a turn-1 tool output carries the new After the merge: instruction text ({FIX_MARK!r})',
        'turn_1_complete': True,
        'record_under_out': RECORD + ' exists after turn 1',
        'wave_accepted': 'the runner summary is accepted (claude: done; codex: merge-ready)',
        'feature_pushed_and_green': f'origin {FEATURE} has the task files and its tests pass; origin main is unchanged',
        'dry_run_lists_record': "a turn-1 wave-cleanup.mjs report with dryRun true lists the record under removed",
        'left_behind_names_record': 'the Left behind: paragraph names runs/wave-1',
        'after_merge_names_record': 'the After the merge: command carries --records and --summary <record>',
        'after_merge_written_out': AFTER_MERGE_WRITTEN_OUT.format(reply="the turn-1 reply"),
        'after_merge_as_printed': AFTER_MERGE_AS_PRINTED.format(turn='turn 1'),
        'turn_2_complete': True,
        'cleanup_removed_record': "a turn-2 wave-cleanup.mjs report with dryRun false lists the record under removed",
        'record_removed': OUT_REL + ' is gone after turn 2',
        'no_wave_worktree_or_branch': 'only the main checkout is registered and no wave/* branch is left',
        'no_removal_by_hand': 'no rm, rmdir, rmtree, find -delete or git worktree remove under .worktrees'})
    bench.dump(out / 'meta.json', {'provider': args.provider, 'model': model, 'effort': args.effort,
                                   'wave_by': args.wave_by,
                                   'versions': versions, 'base': base, 'pkg': str(pkg), 'repo': str(repo),
                                   'loading': 'disposable --plugin-dir, --setting-sources project' if args.provider == 'claude'
                                   else 'workspace skills linked to the snapshot, user config and plugins off',
                                   'children': 'runner children use the normal CLI configuration',
                                   'cli_version': bench.call([shutil.which(args.provider), '--version'])})
    if args.prepare_only:
        print(json.dumps({'prepared': str(out), 'lint': lint.stdout.strip()}, indent=1)); return 0
    isolate(out)
    if args.wave_by == 'driver':
        refs = pkg / 'plugins/orchestration/skills/multi-model/references'
        runner = ['node', str(refs / f'{args.provider}-wave-runner.mjs'), '--plan', str(plan), '--wave', '1',
                  '--repo', str(repo), '--base', base, '--jobs', '1', '--timeout-min', '20', '--out', str(repo / OUT_REL)]
        if args.provider == 'claude': runner += ['--default-branch', 'main']
        print(f'{args.provider}: the driver runs the wave', flush=True)
        bench.run_logged(runner, out, 'wave-run', cwd=repo, timeout=1800)
        record = json.loads((repo / RECORD).read_text()) if (repo / RECORD).is_file() else {}
        if record.get('status') != ('done' if args.provider == 'claude' else 'merge-ready'):
            raise SystemExit(f'blocked: the driver-run wave was not accepted ({record.get("status")}); see wave-run.*')
    sid = str(uuid.uuid4()) if args.provider == 'claude' else None
    print(f'{args.provider}: turn 1, seat {model}/{args.effort}', flush=True)
    rc = bench.run_logged(command(args.provider, 1, sid, repo, out, pkg, model, args.effort, args.budget_usd, args.wave_by),
                          out, 'turn-1', cwd=repo, prompt=prompt_1(args.provider, repo, args.wave_by), timeout=args.timeout)
    rows = read_events(out / 'turn-1.stdout')
    sid = session_id(rows, sid)
    bench.dump(out / 'state-1.json', state_1(out, repo, origin, args.provider))
    merged = merge(origin, base)
    bench.dump(out / 'merge.json', merged)
    if complete(rows, rc) and merged['merged'] and sid:
        print(f'{args.provider}: turn 2', flush=True)
        bench.run_logged(command(args.provider, 2, sid, repo, out, pkg, model, args.effort, min(args.budget_usd, 3),
                                 args.wave_by),
                         out, 'turn-2', cwd=repo, prompt=PROMPT_2, timeout=900)
        bench.dump(out / 'state-2.json', state_2(repo, origin))
    checks, facts = score(out)
    bench.dump(out / 'spend.json', spend(out, args.provider))
    print(json.dumps({'checks': checks, 'facts': {k: facts[k] for k in ('after_merge_command', 'removals_by_hand',
                      'local_feature_after', 'origin_feature_after', 'worktrees_dir_after')},
                      'merge': merged, 'spend': json.loads((out / 'spend.json').read_text())},
                     ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
