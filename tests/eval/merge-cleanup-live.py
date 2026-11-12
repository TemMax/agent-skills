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
             offer the merge as its last line, with nothing after it. Last turn:
             "Yes — merge it." Expected: as mm-merge, for the branch the pull
             request names.
  ship-wave-merge
             As ship-merge, but the user adds "Use agents for the
             implementation.", so the session plans a supervised wave: turn 1
             must end at super-plan's start approval, before any wave or pull
             request, and a later turn runs the wave. In any ship run that
             stops there, the approval's question is its last line.

The candidate is loaded disposably, as in custom-out-cleanup-live.py: Claude
from a `--plugin-dir` snapshot with `--setting-sources project`; Codex from
workspace skills linked to the snapshot, with `--ignore-user-config`,
`--disable plugins` and `--disable apps`. A Codex session runs outside the
sandbox (`danger-full-access`) because it launches the runner, which sandboxes
its children; runner children use the normal CLI configuration. Codex runs its
commands in a login shell by default, and the login profile puts the real gh
ahead of the stub on PATH, so Codex sessions run with
`allow_login_shell=false`. A run whose session reached a real gh or a GitHub
connector is reported as blocked (exit 2), not scored as the product's result.
In every scenario the last reply before the merge turn with an `After the
merge:` line (in ship, the handoff's own) must hold the cleanup command
itself, written out, word for word as a `--dry-run` report printed it (the two
checks of custom-out-cleanup-live.py), and each `--plan` in it must be a plan a
wave ran with. No message to the user may name or link an instruction file
(SKILL.md, WORKFLOW.md, a profile, a reference document; instruction_files.py).
Expectations are frozen in expected.json before the host starts.
The state before the merge turn goes to state-before.json and after it to
state-after.json; checks.json is computed from those files, the traces and the
stub's call log, and `--score DIR` recomputes it.
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

from claude_session_events import read_events
# Instruction files named or linked in a message to the user (shared with
# review-content-live.py).
from instruction_files import EXPECTED_NAMED, instruction_files_named, skill_bodies

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


cleanup = load('out_live', 'custom-out-cleanup-live.py')
bench, plan_live, seat = cleanup.bench, cleanup.plan_live, cleanup.seat
SCENARIOS = ('mm-merge', 'mm-merged-worktree', 'ship-merge', 'ship-wave-merge')
SHIP_SCENARIOS = ('ship-merge', 'ship-wave-merge')
WAVE_SCRIPTS = ('claude-wave-runner.mjs', 'codex-wave-runner.mjs', 'wave-launch.mjs')
FEATURE = 'feature/durations'
SEAT = cleanup.SEAT
# Text only the candidate's instructions carry.
FIX_MARK = 'never name, quote or link an instruction file of the skills you are running'
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
# A sentence that ends with a question mark, once code and links are gone; a
# dot inside a word ("durations.py") does not end it.
QUESTION = re.compile(r'(?:[^.!?？\n]|\.(?=\S))*[?？](?=[\s*_)\]"»”’]|$)')
# The session offering its own merge: "Shall I merge …?", "Merge PR #1?", "Want me to squash it?".
# The verb follows the modal at once (an adverb aside), so "Should I fix the nit, or merge as is?"
# and "… and then merge?" are not offers; merging main into the branch, squashing commits, landing
# a fix on the branch and merge conflicts are other work.
_MERGE_VERB = r"(?:squash(?:-merg\w*)?|merg\w*|land\w*)\b(?!\s+conflicts?\b)"
_NOT_THE_PR = (r"(?![^?？]*\b(?:into|on) (?:the |this |your |its )?(?:feature |topic )?branch\b)"
               r"(?!\s+(?:[\w-]+\s+){0,3}commits\b)")
OWN_MERGE = re.compile(
    r"(?i)(?:\b(?:shall|should|can|may) (?:i|we)|\b(?:want|like|for) me to|\bok(?:ay)? (?:for me )?to)"
    r"(?:\s+(?:now|just|also|then|go ahead (?:and|with)|proceed (?:with|to)))?\s+" + _MERGE_VERB + _NOT_THE_PR +
    r"|^\W*(?:(?:go ahead and|ok(?:ay)?(?: to)?|proceed (?:with|to)|ready (?:for me )?to)\s+)?(?:the\s+)?"
    + _MERGE_VERB + _NOT_THE_PR)
# The merge handed back to the user: "Will you merge …?", "… before you merge?", "Once you have merged
# it, …". Without "you", a step before the merge only counts ahead of the offered verb, so "Shall I
# merge PR #1 and clean up once it is merged?" stays an offer.
HANDS_BACK_YOU = re.compile(r"(?i)\bwill you\b|\b(?:before|once|after|when) you(?:'ve| have)?\b")
HANDS_BACK = re.compile(r"(?i)\bbefore (?:i |we |the |it'?s )?(?:squash|merg|land)"
                        r"|\bonce\b[^?？]*\bmerged\b|\bafter (?:the |it'?s )?(?:squash|merg|land)")
# What a real gh says in this fixture, where it should never be reached.
REAL_GH = re.compile(r'not logged into any GitHub hosts|To get started with GitHub CLI|gh auth login')
# A program run at command position, not a word inside an argument, a pattern or an echo: at the
# start of a line (indented too), after a separator, a keyword, `!` or a VAR=value prefix.
AT_CMD = (r'(?:^[ \t]*|[;&|({]\s*|\$\(\s*|\b(?:then|do|else|time|command|exec|xargs|if|while|until)\s+|!\s+'
          r'|\b[A-Z_][A-Z0-9_]*=\S*\s+)(?:[\w./~-]*/)?')
GH_RUN = re.compile(AT_CMD + r'gh\s+[a-z]', re.M)
MERGE_RUN = re.compile(AT_CMD + r'gh\s+pr\s+merge\b', re.M)
PR_CREATE = re.compile(AT_CMD + r'gh\s+pr\s+create\b', re.M)
VIEW_RUN = re.compile(AT_CMD + r'gh\s+(?:pr\s+view\b|api\s+\S*pulls/\d+)[^\n;&|]*', re.M)
CLEANUP_RUN = re.compile(AT_CMD + r'node\s+(?:\S*/)?wave-cleanup\.mjs\b(?![^\n;&|]*--(?:dry-run|help)\b)', re.M)
GIT_AT = AT_CMD + r'git(?:\s+(?:-[Cc]\s+\S+|--git-dir(?:=|\s+)\S+|--work-tree(?:=|\s+)\S+|--no-pager|-P))*\s+'
FETCH_RUN = re.compile(GIT_AT + r'fetch\b', re.M)


def compare_run(feature):
    """A git command that sets the feature branch against origin/main: merge-base, diff, log,
    cherry, rev-list, range-diff, show, merge-tree, or branch with --contains or --merged."""
    return re.compile(GIT_AT + r'(?:merge-base|diff|log|cherry|rev-list|range-diff|show|merge-tree|branch(?=[^\n;&|]*'
                      r'--(?:contains|merged)\b))\b'
                      rf'(?=[^\n;&|]*(?<![\w/-])(?:origin/)?{re.escape(feature)}(?![\w/-]|\.\w))'
                      r'[^\n;&|]*?(?<![\w-])origin/main\b', re.M)


# An offer of more work; a report that something was not asked is not one.
OFFER = re.compile(r"(?i)\b(?:shall i|should i|do you want me|would you like me|let me know if|tell me if|"
                   r"say (?:so|the word)|on request|if you(?:'d| would)? (?:like|want),? i)\b"
                   r"|(?<!whether you )\bwant me to\b"
                   r"|\bi can (?:also )?[^.?!\n]*\bif you(?:'d| would)? (?:want|like)\b")
TRUE, FALSE = {'true', 'True', 'TRUE', 't', 'T', '1'}, {'false', 'False', 'FALSE', 'f', 'F', '0'}


def prompt_1(provider, scenario, repo):
    if scenario not in SHIP_SCENARIOS:
        return cleanup.prompt_1(provider, repo, 'session')
    skill = 'orchestration:ship' if provider == 'claude' else '$ship'
    agents = ' Use agents for the implementation.' if scenario == 'ship-wave-merge' else ''
    text = f'Use {skill} for the change below.{agents}\n\nChange: {SHIP_REQUEST}\n'
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
    # A login shell would put the real gh ahead of the stub on PATH; apps would reach GitHub itself.
    common = ['--ignore-user-config', '--disable', 'plugins', '--disable', 'apps', '--json', '--skip-git-repo-check',
              '--model', model, '-c', f'model_reasoning_effort="{effort}"', '-c', 'allow_login_shell=false',
              '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false']
    if first:
        return [shutil.which('codex'), 'exec', *common, '-C', str(cwd), '--sandbox', 'danger-full-access', '-']
    return [shutil.which('codex'), 'exec', 'resume', *common, '-c', 'sandbox_mode="danger-full-access"', sid, '-']


def register(cwd, pkg, scenario):
    """Codex workspace skills linked to the snapshot, kept out of git status."""
    skills = SHIP_SKILLS if scenario in SHIP_SCENARIOS else {'orchestration': ['multi-model', 'super-plan']}
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


flat = cleanup.flat


def last_paragraph(text):
    parts = [p.strip() for p in re.split(r'\n[ \t]*\n', text or '') if p.strip()]
    return parts[-1] if parts else ''


def prose(text):
    """The reply without fenced code, code spans and links."""
    text = re.sub(r'(?ms)^[ \t]*(```|~~~).*?^[ \t]*\1[ \t]*$', ' ', text or '')
    text = re.sub(r'`[^`\n]*`', ' ', text)
    return re.sub(r'https?://\S+', ' ', text)


def questions(text):
    return [m.group(0).strip() for m in QUESTION.finditer(prose(text))]


def asks(text):
    """The reply asks the user anything, anywhere, or offers more work."""
    return bool(questions(text) or OFFER.search(text or ''))


def offers_merge(text):
    """The reply's last question offers the session's own merge; text may follow it."""
    found = questions(text)
    own = OWN_MERGE.search(found[-1]) if found else None
    return bool(own and not HANDS_BACK_YOU.search(found[-1]) and not HANDS_BACK.search(found[-1][:own.start()]))


# The question mark ends the line; only closing markup may follow it.
QUESTION_END = re.compile(r'[?？][\s*_)\]"»”’`]*$')


def last_line(text):
    lines = [line for line in (text or '').splitlines() if line.strip()]
    return lines[-1] if lines else ''


def ends_with_question(text):
    """The reply's last non-empty line is a question that ends it."""
    last = last_line(text)
    return bool(questions(last)) and bool(QUESTION_END.search(last))


def question_last(text):
    """The reply ends with its merge offer: its last non-empty line offers the
    session's own merge and ends with that question's mark."""
    return ends_with_question(text) and offers_merge(last_line(text))


def approval_before_wave(rows, turns, merge_turn, handoff_turn, records):
    """Turn 1 stops before the handoff with a question and starts no runner and
    no pull request; then a wave runs before the merge turn: a later turn
    starts a runner or the launcher, or a run record exists (a runner started
    some other way, from a Python script say, still leaves one)."""
    if not turns or handoff_turn == turns[0]:
        return False
    first = commands(rows.get(turns[0], []))
    later = [c for t in turns[1:] if t != merge_turn for c in commands(rows.get(t, []))]
    asked = bool(questions((replies(rows.get(turns[0], [])) or [''])[-1]))
    return (asked and not runner_calls(first)[0] and not any(PR_CREATE.search(c) for c in first)
            and bool(runner_calls(later)[0] or records))


def merge_calls(calls):
    return [c for c in calls if c.get('argv', [])[:2] == ['pr', 'merge']]


def merge_flags(argv):
    """The boolean flags a `gh pr merge` call set, as gh parses them: combined
    short flags split (-sd is -s -d), `--flag=false` not set."""
    found = []
    for a in argv[2:]:
        if re.fullmatch(r'-[A-Za-z]{2,}', a):
            found += ['-' + c for c in a[1:]]
        elif a.startswith('-'):
            name, eq, value = a.partition('=')
            if not eq or value in TRUE:
                found.append(name)
    return found


FORBIDDEN_MERGE_FLAGS = {'--admin', '--auto', '--delete-branch', '-d'}


def squash_merge_ok(calls):
    """Exactly one successful `gh pr merge`, a squash, and no attempt with a
    bypass, auto-merge or branch deletion."""
    merges = merge_calls(calls)
    ok = [c for c in merges if c.get('exit') == 0]
    return (len(ok) == 1 and bool({'--squash', '-s'} & set(merge_flags(ok[0]['argv'])))
            and not any(FORBIDDEN_MERGE_FLAGS & set(merge_flags(c['argv'])) for c in merges))


def shell_script(cmd):
    """The script a `/bin/zsh -c …` command runs, quotes decoded as the shell
    decodes them (Codex joins quoted pieces such as '…'"'"'…'); else the command."""
    try:
        words = shlex.split(cmd or '')
    except ValueError:
        return cmd or ''
    if len(words) >= 3 and re.fullmatch(r'/bin/(?:ba|z)?sh', words[0]) and words[1] in ('-c', '-lc'):
        return words[2]
    return cmd or ''


_NAMES = '(?:' + '|'.join(re.escape(n) for n in WAVE_SCRIPTS) + ')'
# node, then the script path: double-quoted (it may hold "$(realpath …)", a substitution with
# quotes of its own, "$(dirname "$(realpath …)")/…", or end inside one, "$(realpath …/x.mjs)"),
# single-quoted, or bare.
RUNNER_CALL = re.compile(r'\bnode\s+(?:"[^"\n]*' + _NAMES + r'"|"\$\([^\n]*?' + _NAMES + r'\)*"|\'[^\'\n]*' + _NAMES
                         + r'\'|[^\s;&|<>]*' + _NAMES + r')([^\n;&|]*)')


# A shell variable set to a runner's path, as in `r=$(realpath …/codex-wave-runner.mjs)`.
RUNNER_VAR = re.compile(r'\b([A-Za-z_]\w*)=[^\n;&|]*?(' + '|'.join(map(re.escape, WAVE_SCRIPTS)) + r')')


def runner_calls(cmds):
    """How many times the session started a wave runner or the launcher with
    node, directly or through a variable set to its path, and the --plan
    values of those calls."""
    calls, plans = 0, []
    for c in cmds:
        script = shell_script(c).replace('\\\n', ' ')
        for var, name in set(RUNNER_VAR.findall(script)):
            script = re.sub(r'\bnode\s+"?\$(?:\{' + re.escape(var) + r'\}|' + re.escape(var) + r'\b)"?',
                            lambda m: 'node ' + name, script)
        for m in RUNNER_CALL.finditer(script):
            calls += 1
            plans += [v.strip('\'"') for v in re.findall(r'--plan(?:=|\s+)(\S+)', m.group(1))]
    return calls, plans


def unwrap(cmd):
    """A Codex command without its `/bin/zsh -c '…'` wrapper."""
    m = re.fullmatch(r"\s*/bin/(?:ba|z)?sh\s+-l?c\s+'(.*)'\s*", cmd or '', re.S)
    if m:
        return m.group(1).replace("'\\''", "'")
    m = re.fullmatch(r'\s*/bin/(?:ba|z)?sh\s+-l?c\s+"(.*)"\s*', cmd or '', re.S)
    return m.group(1).replace('\\"', '"') if m else cmd or ''


def steps(rows):
    """(command, output) of each main-session shell step, in order."""
    found, index = [], {}
    for r in rows:
        item = r.get('item') or {}
        if r.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            found.append([unwrap(item.get('command')), item.get('aggregated_output') or ''])
        if r.get('type') == 'assistant' and not r.get('parent_tool_use_id'):
            for b in (r.get('message') or {}).get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'Bash':
                    if b.get('id') is not None:
                        index[b['id']] = len(found)
                    found.append([(b.get('input') or {}).get('command') or '', ''])
        if r.get('type') == 'user' and not r.get('parent_tool_use_id'):
            content = (r.get('message') or {}).get('content')
            for b in content if isinstance(content, list) else []:
                if isinstance(b, dict) and b.get('type') == 'tool_result' and b.get('tool_use_id', object()) in index:
                    c = b.get('content')
                    found[index[b['tool_use_id']]][1] = c if isinstance(c, str) else ''.join(
                        x.get('text') or '' for x in c or [] if isinstance(x, dict))
    return [tuple(s) for s in found]


def cleanup_report_in(text):
    """The text carries a wave-cleanup.mjs report that is not a dry run."""
    decoder = json.JSONDecoder()
    for m in re.finditer(r'\{\s*"into"', text or ''):
        try:
            obj, _ = decoder.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get('removed'), list) and obj.get('dryRun') is False:
            return True
    return False


def reads_state(view):
    """A `gh pr view` that shows the state: the human view, a --json list naming
    `state`, or the pulls API."""
    return ' api ' in f' {view} ' or '--json' not in view or bool(re.search(r'--json[ =]\S*\bstate\b', view))


def stub_confirms(calls):
    """In the stub's log of the merge turn, a successful view of the state after
    the session's last successful merge."""
    merged = [i for i, c in enumerate(calls) if c.get('argv', [])[:2] == ['pr', 'merge'] and c.get('exit') == 0]
    return any(i > (merged[-1] if merged else -1) and c.get('exit') == 0
               and (c.get('argv', [])[:2] == ['pr', 'view'] and reads_state(' '.join(c['argv']))
                    or c.get('argv', [])[:1] == ['api'] and any(re.search(r'pulls/\d+$', a) for a in c['argv']))
               for i, c in enumerate(calls))


def confirmed_before_cleanup(step_list, calls, feature=FEATURE):
    """The session confirmed the merge after its last merge and before the
    cleanup, in a step whose result it could read before it ran the cleanup.
    In trace order, after the last `gh pr merge` and in a step before the first
    cleanup step — a `node …wave-cleanup.mjs` that is not a dry run, or a step
    whose output is the script's report — either a `gh pr view` of the state
    (or the pulls API) that the stub's log shows answering, or a `git fetch`
    followed by a git command that sets the feature branch against
    `origin/main` (see compare_run)."""
    compare = compare_run(feature)
    events = []
    for i, (cmd, out) in enumerate(step_list):
        events += [((i, m.start()), 'merge') for m in MERGE_RUN.finditer(cmd)]
        events += [((i, m.start()), 'view') for m in VIEW_RUN.finditer(cmd) if reads_state(m.group(0))]
        events += [((i, m.start()), 'fetch') for m in FETCH_RUN.finditer(cmd)]
        events += [((i, m.start()), 'compare') for m in compare.finditer(cmd)]
        found = [((i, m.start()), 'cleanup') for m in CLEANUP_RUN.finditer(cmd)]
        events += found or ([((i, len(cmd)), 'cleanup')] if cleanup_report_in(out) else [])
    events.sort()
    cleanup = next((at for at, kind in events if kind == 'cleanup'), None)
    if cleanup is None:
        return False
    last_merge = max((at for at, kind in events if kind == 'merge' and at < cleanup), default=(-1, -1))
    between = [(at, kind) for at, kind in events if last_merge < at < cleanup]
    # Only a step before the cleanup's own step: a check chained into the cleanup's command line
    # runs without the session reading it.
    readable = [(at, kind) for at, kind in between if at[0] < cleanup[0]]
    by_gh = stub_confirms(calls) and any(kind == 'view' for _, kind in readable)
    fetch = next((at for at, kind in between if kind == 'fetch'), None)
    return by_gh or (fetch is not None and any(kind == 'compare' and at > fetch for at, kind in readable))


def removes_branch(report, name):
    return any(isinstance(item, dict) and item.get('kind') == 'branch' and item.get('branch') == name
               and 'task' not in item for item in report.get('removed') or [])


GIT = r'\bgit(?:\s+(?:-[Cc]\s+\S+|--git-dir(?:=|\s+)\S+|--work-tree(?:=|\s+)\S+))*\s+'


def manual_branch_removal(cmds, name):
    """The feature branch deleted by hand instead of by the cleanup script."""
    esc = re.escape(name)
    pat = re.compile(GIT + rf'(?:branch\s+[^\n;&|]*(?:(?<=\s)-[A-Za-z]*[dD][A-Za-z]*(?=\s)|--delete\b)'
                     rf'[^\n;&|]*(?<![\w/.-]){esc}(?![\w/.-])|update-ref\s+-d\s+refs/heads/{esc}(?![\w/.-]))')
    return [c for c in cmds if pat.search(c)]


def boundary(meta, calls, rows):
    """Why the run left the fixture: a real gh or a GitHub connector reached."""
    found = [f'a real gh answered: {o.strip()[:160]!r}' for o in outputs(rows) if REAL_GH.search(o)]
    found += [f'connector call: {(r.get("item") or {}).get("server")}/{(r.get("item") or {}).get("tool")}'
              for r in rows if r.get('type') == 'item.completed' and (r.get('item') or {}).get('type') == 'mcp_tool_call']
    session_calls = len(calls) - len(meta.get('driver_calls') or [])
    if session_calls <= 0 and any(GH_RUN.search(cmd) for cmd, _ in steps(rows)):
        found.append('the session ran gh, but the stub logged none of its calls')
    return found


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
    ship = scenario in SHIP_SCENARIOS
    feature = (prs[0]['headRefName'] if prs else None) if ship else FEATURE
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
        name = 'ship' if ship else 'multi-model'
        loaded = os.path.realpath(cwd / '.agents/skills' / name).startswith(os.path.realpath(pkg) + os.sep)
    detached = scenario == 'mm-merged-worktree'
    pr = prs[0] if prs else {}
    checks = {
        'candidate_loaded': loaded,
        'instruction_read': any(FIX_MARK in flat(t) for t in outputs(all_rows) + skill_bodies(all_rows)),
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
        'merge_confirmed_before_cleanup': confirmed_before_cleanup(steps(merge_rows), merge_session, feature or FEATURE),
        'no_question_after_merge': bool(merge_rows) and not asks(final),
        'no_instruction_file_named': not instruction_files_named(all_rows),
    }
    if ship:
        checks['handoff_offers_merge'] = offers_merge(handoff)
        checks['handoff_question_last'] = question_last(handoff)
    if scenario == 'ship-wave-merge':
        checks['start_approval_before_wave'] = approval_before_wave(rows, turns, merge_turn, handoff_turn,
                                                                    before.get('summaries'))
    # A ship session that stopped before its handoff stopped at the start approval.
    if scenario == 'ship-wave-merge' or ship and turns and handoff_turn and handoff_turn != turns[0]:
        checks['start_question_last'] = ends_with_question((replies(rows.get(turns[0], [])) or [''])[-1])
    # Every scenario leaves at least the feature branch before the merge, so the
    # last reply before the merge turn must carry the command after the merge,
    # with or without a plan.
    pre_rows = [r for t in turns if t != merge_turn for r in rows.get(t, [])]
    # ship: the handoff itself, never an earlier turn's line.
    source = rows.get(handoff_turn, []) if ship and handoff_turn else pre_rows
    carrying = [t for t in replies(source) if re.search(cleanup.MARK.format('after the merge'), t)]
    pre_reply = carrying[-1] if carrying else ''
    written = cleanup.after_merge_written(pre_reply)
    words = cleanup.command_words(written) or []
    plans = [words[i + 1] for i, w in enumerate(words[:-1]) if w == '--plan']
    # A wave ran when a run record exists before the merge turn or the session
    # started a runner or the launcher; each --plan written out must be one of
    # the plans those calls named (by path, or by name when the call used a
    # variable or another working directory).
    started, run_plans = runner_calls(commands(pre_rows))
    waved = bool(started) or bool(before.get('summaries'))
    known = {os.path.realpath(p if os.path.isabs(p) else os.path.join(cwd, p)) for p in run_plans}
    names = {os.path.basename(p) for p in run_plans}
    # A --plan given through a variable cannot be compared: then any plan passes.
    opaque = not run_plans or any(re.search(r'[$`]', p) for p in run_plans)
    from_run = lambda p: opaque or os.path.realpath(p) in known or os.path.basename(p) in names
    checks['after_merge_written_out'] = bool(written)
    checks['after_merge_as_printed'] = cleanup.as_printed(pre_reply, pre_rows)
    checks['after_merge_plans_from_run'] = (all('/.git/' not in p for p in plans) and (waved or not plans)
                                            and all(from_run(p) for p in plans))
    blocked = boundary(meta, calls, all_rows)
    facts = {'feature': feature, 'merge_calls': merge_calls(merge_session), 'blocked': blocked,
             'merge_turn_commands': merge_cmds, 'merge_turn_reports': merge_reports,
             'manual_branch_removal': manual_branch_removal(merge_cmds, feature or FEATURE),
             'handoff_last_question': (questions(handoff) or [''])[-1], 'final_questions': questions(final),
             'after_merge_command': cleanup.after_merge_written(pre_reply),
             'after_merge_commands': cleanup.after_merge_commands(pre_reply),
             'printed_commands': [' '.join(w) for w in cleanup.printed_commands(pre_rows) if w],
             'run_records_before': before.get('summaries'), 'after_merge_plans': plans, 'wave_ran': waved,
             'instruction_files_named': instruction_files_named(all_rows),
             'runner_calls': started, 'runner_plans': run_plans,
             'final_reply': final,
             'head_after': after.get('head_branch'), 'branches_after': after.get('branches'),
             'summaries_after': after.get('summaries'), 'origin_feature_after': after.get('origin_feature'),
             'script_paths': cleanup.script_paths([c for t in turns for c in commands(rows.get(t, []))])}
    bench.dump(out / 'checks.json', {'checks': checks, 'facts': facts,
                                     'status': 'blocked' if blocked else 'pass' if all(checks.values()) else 'fail'})
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
    'instruction_read': f'a tool output or a Claude skill load carries the candidate\'s new text ({FIX_MARK!r})',
    'turns_complete': 'every invocation ends in success',
    'feature_pushed_and_green': 'before the merge turn the feature branch on origin has src/durations.py and '
                                'tests/test_durations.py, its tests pass, and origin main is unchanged',
    'pr_ready_before_merge': 'pull request #1 from the feature branch into main exists before the merge turn: open '
                             '(mm-merge and the ship scenarios) or merged by the driver (mm-merged-worktree)',
    'merge_by_session': 'mm-merge and the ship scenarios: exactly one successful gh pr merge in the merge turn, '
                        'a squash (--squash, --squash=true or -s), and no merge attempt with --admin, --auto, '
                        '--delete-branch or -d; mm-merged-worktree: no gh pr merge at all',
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
    'merge_confirmed_before_cleanup': "in the merge turn, after the session's last gh pr merge and in a step "
                                      'before the first cleanup step (node …wave-cleanup.mjs without --dry-run or '
                                      "--help, or a step whose output is the script's report): a gh pr view that "
                                      'reads the state (the human view, a --json list naming state, or gh api '
                                      '.../pulls/N) that the stub logged answering after the last successful merge, '
                                      'or a git fetch and then a git command that sets the feature branch against '
                                      'origin/main (merge-base, diff, log, cherry, rev-list, range-diff, show, '
                                      'merge-tree, branch --contains or --merged); commands count at command '
                                      'position, indented lines, if/while, ! and VAR=value prefixes included',
    'after_merge_written_out': cleanup.AFTER_MERGE_WRITTEN_OUT.format(
        reply='the last reply before the merge turn with an After the merge: line, in the ship scenarios the last '
              'such reply of the handoff turn (no such reply fails)'),
    'after_merge_as_printed': cleanup.AFTER_MERGE_AS_PRINTED.format(turn='a turn before the merge turn'),
    'after_merge_plans_from_run': 'every --plan of the command written out is a plan the run executed: none under '
                                  '.git; none at all when no wave ran before the merge turn (no summary.json under '
                                  '.worktrees in state-before.json and no node call of claude-wave-runner.mjs, '
                                  'codex-wave-runner.mjs or wave-launch.mjs); and, when those calls name --plan '
                                  'values, each one of them (the same path, or the same file name; any plan when '
                                  'a call gives --plan through a shell variable)',
    'no_instruction_file_named': EXPECTED_NAMED,
    'no_question_after_merge': "the merge turn's last reply has no sentence ending in a question mark (? or ？) "
                               'outside code and links, and offers no more work (shall/should I, do you want '
                               'me, would you like me, want me to — not "whether you want me to" —, let me '
                               "know if, tell me if, say so, say the word, on request, I can … if you want)",
}
HANDOFF_EXPECTED = ("the handoff reply's last sentence ending in a question mark (outside code and links) offers "
                    'the session\'s own merge, the verb right after the modal — "Shall I merge …?", "Merge PR #1?", '
                    '"Want me to squash it?" — not merging main into the branch, squashing commits, landing a fix on '
                    'the branch, or "… or merge"/"… and then merge"; it does not hand the merge back ("Will you merge '
                    '…?", "… before you merge?", "Once you have merged it, …"), and "before/once … merged/after the '
                    'merge" ahead of the offered verb hands it back too; text may follow it')
HANDOFF_LAST_EXPECTED = ("the handoff reply's last non-empty line offers the session's own merge, by "
                         'handoff_offers_merge\'s rule applied to that line alone, and ends with the question mark; '
                         'only closing markup (*, _, ), ], `, quotes) may follow it on the line')
START_LAST_EXPECTED = ("ship-wave-merge, and a ship-merge run whose first turn stopped before the handoff: that "
                       "turn's last reply (the start approval) has a question as its last non-empty line, ending "
                       'with the question mark; only closing markup may follow it on the line')
APPROVAL_EXPECTED = ('ship-wave-merge: turn 1 stops before the handoff with a question (the start approval) and '
                     'runs no wave runner or launcher and no gh pr create; then a wave runs before the merge turn: a '
                     'later turn starts a runner or the launcher with node, or a run record (summary.json under '
                     '.worktrees) exists before the merge turn')
BOUNDARY = ('a run is blocked, not scored, when a tool output shows a real gh, the session called a GitHub '
            'connector, or the session ran gh (at command position) while the stub logged none of its calls')


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
        return 2 if facts['blocked'] else 0 if all(checks.values()) else 1
    if not (args.provider and args.scenario and args.out):
        p.error('--provider, --scenario and --out are required')
    out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    model = args.model or SEAT[args.provider]
    ship = args.scenario in SHIP_SCENARIOS
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
                                       'effort': args.effort, **EXPECTED, 'boundary': BOUNDARY,
                                       **({'handoff_offers_merge': HANDOFF_EXPECTED,
                                           'handoff_question_last': HANDOFF_LAST_EXPECTED} if ship else {}),
                                       **({'start_approval_before_wave': APPROVAL_EXPECTED}
                                          if args.scenario == 'ship-wave-merge' else {}),
                                       **({'start_question_last': START_LAST_EXPECTED} if ship else {})})
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
                      'manual_branch_removal', 'summaries_after', 'blocked')},
                      'spend': json.loads((out / 'spend.json').read_text())}, ensure_ascii=False, indent=1))
    if facts['blocked']:
        print('BLOCKED: the session left the fixture; this run is not a product result', flush=True)
        return 2
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
