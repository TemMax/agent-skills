#!/usr/bin/env python3
"""Live seat flows on Claude Code: the session itself runs multi-model or ship.

The seat session loads the candidate disposably (`--plugin-dir` snapshot of
the working tree, `--setting-sources project`); no installed plugin,
marketplace or configuration is changed. The wave runner's children start
with the normal CLI configuration, as in every run (execution-cost-controls.md),
so they load the user's installed plugins and hooks. The fixture is
plan-content-live.py's `interfaces` repository with a local bare `origin`.
Expectations are frozen in expected.json before the host starts; the trace
is kept in run.stdout.

Cases:
  wave — the plan below (one Haiku 5.5 task under a Sonnet 5.5 supervisor) is
         committed and pushed as approved; the session executes it with
         multi-model. Expected: the shipped Claude runner runs the wave, the
         task's files reach `main` on `origin`, its tests pass there, nothing
         outside the contract changes and no pull request is opened. With
         `--supervisor claude-fable-5-2` the plan's supervisor is Fable 5.2,
         approved as premium on the user's word (ADR 020); expected instead of
         "no role on Fable 5.2": the judge child runs on claude-fable-5-2 and
         no executor does.
  ship — the session runs ship on the `interfaces` request. With no user to
         answer, the run must stop at its one start approval (Gate 2): a
         lint-clean plan, no runner, no wave branch, no product file changed.
  ship-e2e — ship end to end: the same request, a fixture whose AGENTS.md
         allows a pull request and whose `origin` is a GitHub ssh remote
         served from the local bare repository (GIT_SSH_COMMAND), and
         gh-stub.py first on PATH as the pull request host. The real `gh`
         gets an empty GH_CONFIG_DIR; git gets the fixture's own global
         config, no system config, no credential helper and no ssh agent,
         https GitHub URLs go to the same ssh command, and a plain `ssh`
         refuses — so neither can act on GitHub. The session stops at Gate 2;
         the driver resumes the same session with an approval (run2) and, if
         it stops again, at most twice more with "proceed with your
         recommendation" (run3, run4). Time limits per invocation: 1200 s,
         3600 s, 900 s and 900 s (`--timeout` is for the other cases).
         Expected: waves run by the snapshot's runner, one pull request into
         main, critical-review in the session on that pull request, any direct
         fix checked on Opus 5.5, main untouched, the feature branch's tests
         green, and a handoff with the PR link and the `Left behind:` line.

Every check is computed from the retained artifacts into checks.json: the
seat checks C1-C3 from run.stdout (the profile the session read with Read or
a shell call, every Agent spawn's model, the final reply) and the case checks
from the repository, the bare origin and the runner's summary.json.
`--score DIR --profile NAME[,NAME]` recomputes the seat checks of any
retained Claude run directory, including plan-content-live.py and
review-content-live.py runs; `--score DIR --case ship-e2e` recomputes every
ship-e2e check into checks-rescored.json. Results:
tests/eval/fable-5-2-results-2026-11-10.md and
tests/eval/fable-5-2-ship-e2e-results-2026-11-11.md.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
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


# A seat profile file; the reviewer dossier and the drift prompt and hook are not profiles.
PROFILE_RE = re.compile(r'(?:orchestrator|reviewer)-(?!dossier\.md|drift-)[a-z0-9.-]+\.md')
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
    through `fable`; the final reply names no profile file. `profile` is one
    file name or several (ship end to end reads both seats' profiles)."""
    profiles = {profile} if isinstance(profile, str) else set(profile)
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
              'profile_read': profiles <= reads,
              'no_other_profile_read': not (touched - profiles),
              'no_spawn_without_model': all(spawns),
              'no_spawn_through_fable': not any(str(m).startswith('fable') or m == 'claude-fable-5-2'
                                                for m in spawns),
              'final_reply_names_no_profile_file': not PROFILE_RE.search(res.get('result') or '')}
    return checks, {'profiles_read': sorted(reads), 'profiles_touched': sorted(touched),
                    'spawn_models': spawns, 'models_billed': sorted((res.get('modelUsage') or {}).keys())}


def score(run_dir, profile):
    rows = [r for name in ('run', 'run2', 'run3', 'run4') if (run_dir / f'{name}.stdout').exists()
            for r in read_events(run_dir / f'{name}.stdout')]
    checks, facts = seat_checks(rows, profile.split(','))
    bench.dump(run_dir / 'seat-checks.json', {'checks': checks, 'facts': facts})
    print(json.dumps({'checks': checks, 'facts': facts}, indent=1))
    return 0 if all(checks.values()) else 1


APPROVE = 'Approved — start the run.\n'
PROCEED = 'Proceed with your recommendation.\n'


PREMIUM_APPROVAL = (',\n  "approvals": { "premium": { "models": ["claude-fable-5-2"],\n'
                    '    "reason": "user\'s instruction in this session: Fable 5.2 supervises every wave",\n'
                    '    "approved_by": "user", "date": "2026-11-13" } }\n}\n```')


def wave_plan(supervisor):
    """The approved wave plan; a premium supervisor carries its approval."""
    if not supervisor:
        return PLAN
    plan = PLAN.replace('"supervisor": { "model": "claude-sonnet-5-5", "effort": "high" }',
                        '"supervisor": { "model": "%s", "effort": "high" }' % supervisor, 1)
    tail = 'the unit tests are its only consumer"\n}\n```'
    assert plan.count(tail) == 1
    return plan.replace(tail, 'the unit tests are its only consumer"' + PREMIUM_APPROVAL, 1)


def prompt_for(case):
    if case == 'wave':
        return ('Use orchestration:multi-model to execute the approved plan at '
                f'{PLAN_REL} in this repository. The user gave the start approval (Gate 2) '
                'for this plan as written; no user can answer questions during this run. '
                'Run its wave, integrate the result into main, verify it, and finish the run. '
                'The remote `origin` is a local bare repository; pushing to it is allowed. '
                'Do not open a pull request.\n')
    if case == 'ship-e2e':
        return f'Use orchestration:ship for the change below.\n\nChange: {plan_live.REQUESTS["interfaces"]}\n'
    return ("Use orchestration:ship for the change below. This repository's remote `origin` "
            'is a local bare repository with no pull-request host.\n\n'
            f'Change: {plan_live.REQUESTS["interfaces"]}\n')


def command(out, pkg, model, effort, budget, session=None, plugins=('orchestration',)):
    session = session or ['--session-id', str(uuid.uuid4())]
    return [shutil.which('claude'), '-p', '--verbose', '--output-format', 'stream-json',
            '--model', model, '--effort', effort, *session,
            '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
            '--allowedTools', 'Read,Glob,Grep,Bash,Skill,Write,Edit,Agent',
            '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--add-dir', str(pkg),
            *[a for name in plugins for a in ('--plugin-dir', str(pkg / 'plugins' / name))],
            '--max-budget-usd', str(budget)]


def files(repo):
    return {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
            for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts}


OWNER, REPO_NAME = 'fixture-owner', 'duration-fixture'
GH_URL = f'git@github.com:{OWNER}/{REPO_NAME}.git'
E2E_SCOPE = re.compile(r'^(?:src/(?:durations|cli|config)\.py|README\.md|tests/test_\w+\.py'
                       r'|docs/superpowers/plans/[^/]+\.md)$')
RUNNER = ('claude-wave-runner.mjs', 'wave-launch.mjs')
E2E_PROFILES = ['orchestrator-fable-5-2.md', 'reviewer-fable-5-2.md']


SSH = """import os, shlex, sys
words = shlex.split(sys.argv[-1])
if len(words) != 2 or words[0] not in ('git-upload-pack', 'git-receive-pack', 'git-upload-archive') \\
        or not words[1].strip('/').endswith(%r):
    sys.exit('fixture-ssh: only the fixture repository is served: ' + sys.argv[-1])
os.execvp('git', ['git', words[0][4:], os.environ['GH_STUB_ORIGIN']])
"""


def e2e_environment(out, origin):
    """The session's environment: the stub gh first on PATH, the real gh with
    no credentials, a global git config of the fixture's own, and an ssh
    command that serves the GitHub-style origin from the local bare
    repository, so `git remote -v` shows a GitHub remote."""
    bindir = out / 'bin'; bindir.mkdir()
    stub = bindir / 'gh'
    stub.write_text(f'#!{sys.executable}\n' + Path(__file__).with_name('gh-stub.py').read_text())
    stub.chmod(0o755)
    ssh = bindir / 'fixture-ssh'
    ssh.write_text(f'#!{sys.executable}\n' + SSH % f'{OWNER}/{REPO_NAME}.git')
    ssh.chmod(0o755)
    # A plain ssh would use the user's keys; git reaches the origin through GIT_SSH_COMMAND.
    block = bindir / 'ssh'
    block.write_text(f'#!{sys.executable}\nimport sys\n'
                     'sys.exit("fixture: ssh is disabled; git reaches the fixture origin through GIT_SSH_COMMAND")\n')
    block.chmod(0o755)
    (out / 'gh-config').mkdir()
    gitconfig = out / 'gitconfig'
    gitconfig.write_text('[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n'
                         '[credential]\n\thelper =\n[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n')
    for k in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'SSH_AUTH_SOCK'):
        os.environ.pop(k, None)
    os.environ.update({'PATH': f'{bindir}{os.pathsep}{os.environ["PATH"]}',
                       'GH_CONFIG_DIR': str(out / 'gh-config'), 'GIT_CONFIG_GLOBAL': str(gitconfig),
                       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_TERMINAL_PROMPT': '0',
                       'GIT_SSH_COMMAND': str(ssh), 'GIT_SSH_VARIANT': 'simple',
                       'GH_STUB_STATE': str(out / 'gh-state.json'), 'GH_STUB_LOG': str(out / 'gh-calls.jsonl'),
                       'GH_STUB_ORIGIN': str(origin), 'GH_STUB_OWNER': OWNER, 'GH_STUB_REPO': REPO_NAME})


def gh_calls(out):
    path = out / 'gh-calls.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def pr_state(out):
    path = out / 'gh-state.json'
    return json.loads(path.read_text()).get('prs', []) if path.exists() else []


def bare(origin, *args):
    return bench.call(['git', '--git-dir', str(origin), *args])


def last_reply(out, name):
    return final_result(read_events(out / f'{name}.stdout')).get('result') or ''


def ship_e2e(args, out, pkg, versions):
    repo, _ = plan_live.fixture(out, 'interfaces')
    (repo / 'AGENTS.md').write_text('Read README.md before changing the repository.\n')
    bench.git(repo, 'commit', '-q', '-a', '--amend', '-m', 'Frozen fixture')
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', '-b', 'main', str(origin)])
    e2e_environment(out, origin)
    bench.git(repo, 'remote', 'add', 'origin', GH_URL)
    bench.git(repo, 'push', '-q', '-u', 'origin', 'main')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    profiles = E2E_PROFILES
    expected = {
        'case': 'ship-e2e', 'seat_model': args.model, 'effort': args.effort,
        'run_complete': 'every invocation ends in success', 'profile_read': profiles,
        'no_other_profile_read': True, 'no_spawn_without_model': True, 'no_spawn_through_fable': True,
        'final_reply_names_no_profile_file': 'no reply names a profile file',
        'stops_at_gate_2': 'run 1 stops at the one start approval: no runner, no branch on origin, '
                           'no wave branch or extra worktree, only docs/ changed',
        'gate_2_message': 'asks for the approval, names the branch and says what happens about a pull request',
        'plan_lint_clean': True, 'plan_names_no_claude_fable_5_2': True,
        'no_stop_after_approval': 'after the approval the session reaches the handoff in that one invocation',
        'branch_pushed': 'the feature branch, named in the Gate 2 reply and not a wave branch, is on origin',
        'waves_by_snapshot_runner': "the snapshot's runner ran the waves and launched children",
        'no_role_on_claude_fable_5_2': 'no child and no plan file names claude-fable-5-2',
        'plan_done': 'every plan file in the checkout ends with status: done',
        'pr_opened_once': 'one successful gh pr create, into main from the feature branch',
        'pr_body_runtime_line': 'the pull request body carries a Runtime pass: line',
        'review_protocol_ran': 'after the pull request the session loads critical-review and itself runs '
                               'gh pr view, the review-threads GraphQL query and gh pr diff on it',
        'direct_fix_checked_on_opus': 'a commit pushed after the pull request outside a supervised wave '
                                      'comes with an Agent spawn on opus, started after the last fix commit '
                                      'exists and naming it or the commit the fixes start from',
        'no_merge': 'origin main unchanged and no gh pr merge',
        'feature_tests_pass': 'the unit tests pass on a clone of the feature branch',
        'scope': 'main...feature touches only src/durations.py, src/cli.py, src/config.py, README.md, '
                 'tests/test_*.py and plan files',
        'handoff_report': 'the last reply carries the pull request link, Left behind: and Runtime pass:',
        'handoff_asks_yes_no': "the last reply's last paragraph asks a question"}
    bench.dump(out / 'expected.json', expected)
    bench.dump(out / 'meta.json', {'case': 'ship-e2e', 'model': args.model, 'effort': args.effort,
                                   'versions': versions, 'base': base, 'pkg': str(pkg), 'origin_url': GH_URL,
                                   'loading': 'seat: disposable --plugin-dir (orchestration, code-review), '
                                              '--setting-sources project; runner children: normal CLI '
                                              'configuration; gh-stub.py as the PR host',
                                   'cli_version': bench.call([shutil.which('claude'), '--version'])})
    if args.prepare_only:
        print(json.dumps({'prepared': str(out), 'origin': GH_URL,
                          'gh': bench.call(['gh', 'auth', 'status'])}, indent=1)); return 0
    sid, plugins, rcs = str(uuid.uuid4()), ('orchestration', 'code-review'), {}
    print(f'ship-e2e: seat {args.model}/{args.effort}, session {sid}', flush=True)
    rcs['run'] = bench.run_logged(command(out, pkg, args.model, args.effort, args.budget_usd,
                                          ['--session-id', sid], plugins),
                                  out, 'run', cwd=repo, prompt=prompt_for('ship-e2e'), timeout=1200)
    gate = gate_checks(out, repo, origin, base, pkg)
    names = ['run']
    for name, prompt, timeout in (('run2', APPROVE, 3600), ('run3', PROCEED, 900), ('run4', PROCEED, 900)):
        prs = pr_state(out)
        if prs and 'Left behind:' in last_reply(out, names[-1]) or rcs[names[-1]] != 0:
            break
        print(f'ship-e2e: {name}', flush=True)
        rcs[name] = bench.run_logged(command(out, pkg, args.model, args.effort, args.budget_usd,
                                             ['--resume', sid], plugins),
                                     out, name, cwd=repo, prompt=prompt, timeout=timeout)
        names.append(name)
    return e2e_score(out, rcs, gate, 'checks')


def expand(text, env):
    return re.sub(r'\$(?:\{(\w+)\}|(\w+))', lambda m: env.get(m.group(1) or m.group(2), m.group(0)), text)


def launch_scripts(command):
    """The runner scripts a shell command starts: a statement whose program is
    node, whose script is claude-wave-runner.mjs or wave-launch.mjs and whose
    arguments carry --wave. Variables assigned earlier in the same command
    (`R=…; node $R/…`) are expanded. A mention, such as a grep over the
    runner files, is no launch."""
    env, scripts = {}, []
    for stmt in re.split(r'\s*(?:;|&&|\|\||\n)\s*', command):
        try:
            words = shlex.split(expand(stmt, env))
        except ValueError:
            continue
        if words[:1] == ['export']:
            words = words[1:]
        if len(words) == 1 and re.fullmatch(r'[A-Za-z_]\w*=.*', words[0]):
            name, value = words[0].split('=', 1)
            env[name] = value
            continue
        while words and (words[0] in ('env', 'nohup', 'exec', 'command')
                         or re.fullmatch(r'[A-Za-z_]\w*=.*', words[0])):
            words = words[1:]
        if words[:1] == ['timeout']:
            words = words[2:]
        if len(words) > 2 and os.path.basename(words[0]) == 'node' \
                and os.path.basename(words[1]) in RUNNER and '--wave' in words[2:]:
            scripts.append(words[1])
    return scripts


def is_launch(command):
    return bool(launch_scripts(command))


def in_package(script, pkg):
    return os.path.realpath(script).startswith(os.path.realpath(pkg) + os.sep)


def gate_message(final):
    return bool(re.search(r'(?i)approv', final) and re.search(r'(?i)\bbranch\b', final)
                and re.search(r'(?i)pull request|\bPR\b', final))


def bash_commands(rows):
    return [inp.get('command') or '' for name, inp in tool_uses(rows) if name == 'Bash']


# A git command that moves the repository: a push, commit or merge, a new
# branch or a new worktree. `merge-base`, `branch -a` and the like are reads.
GIT_MOVE = re.compile(r'\bgit\s+(?:-C\s+\S+\s+)?(?:push|commit|merge|switch\s+-c|checkout\s+-b|worktree\s+add'
                      r'|branch\s+(?!-)[\w./-]+)(?![\w-])')


def gate_checks(out, repo, origin, base, pkg):
    """Run 1's stop at Gate 2, from the repository and origin as run 1 left them."""
    cmds = bash_commands(read_events(out / 'run.stdout'))
    plans = sorted(repo.glob('docs/superpowers/plans/*.md'))
    facts = {'head_at_gate': bench.git(repo, 'rev-parse', 'HEAD'),
             'origin_heads_at_gate': bare(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(),
             'local_branches_at_gate': bench.git(repo, 'for-each-ref', '--format=%(refname:short)',
                                                 'refs/heads').split(),
             'worktrees_at_gate': sum(line.startswith('worktree ') for line in
                                      bench.git(repo, 'worktree', 'list', '--porcelain').splitlines()),
             'launches': sum(map(is_launch, cmds)),
             'changed': [l[3:] for l in bench.git(repo, 'status', '--porcelain', '-uall').splitlines()],
             'lint': {str(f.relative_to(repo)): subprocess.run(['node', str(pkg / LINT), str(f), '--repo', str(repo)],
                                                               capture_output=True, text=True).returncode
                      for f in plans}}
    checks = {'stops_at_gate_2': not facts['launches'] and facts['head_at_gate'] == base
                                 and facts['origin_heads_at_gate'] == ['main']
                                 and not any(b.startswith('wave/') for b in facts['local_branches_at_gate'])
                                 and facts['worktrees_at_gate'] == 1
                                 and all(f.startswith('docs/') for f in facts['changed']),
              'gate_2_message': gate_message(last_reply(out, 'run')),
              'plan_lint_clean': bool(facts['lint']) and not any(facts['lint'].values()),
              'plan_names_no_claude_fable_5_2': not any('claude-fable-5-2' in f.read_text() for f in plans)}
    bench.dump(out / 'gate.json', {'checks': checks, **facts})
    return checks


def gate_rescore(out, base):
    """The Gate 2 checks again from kept artifacts: gate.json and run 1's trace.
    A gate.json written before the branch and worktree facts were kept stands
    in run 1's git moves (push, commit, merge, a new branch or worktree)."""
    kept = json.loads((out / 'gate.json').read_text())
    cmds = bash_commands(read_events(out / 'run.stdout'))
    stop = not any(map(is_launch, cmds)) and all(f.startswith('docs/') for f in kept.get('changed', []))
    if 'local_branches_at_gate' in kept:
        stop = stop and kept['head_at_gate'] == base and kept['origin_heads_at_gate'] == ['main'] \
            and not any(b.startswith('wave/') for b in kept['local_branches_at_gate']) \
            and kept['worktrees_at_gate'] == 1
    else:
        stop = stop and not any(GIT_MOVE.search(c) for c in cmds)
    return {**kept['checks'], 'stops_at_gate_2': stop, 'gate_2_message': gate_message(last_reply(out, 'run'))}


def main_sequence(rows):
    """The main session's tool calls and tool results in order: ('use', name,
    input) and ('result', None, text)."""
    seq = []
    for r in rows:
        if r.get('parent_tool_use_id') or r.get('type') not in ('assistant', 'user'):
            continue
        content = (r.get('message') or {}).get('content')
        for b in content if isinstance(content, list) else []:
            if not isinstance(b, dict):
                continue
            if r['type'] == 'assistant' and b.get('type') == 'tool_use':
                seq.append(('use', b.get('name'), b.get('input') or {}))
            elif r['type'] == 'user' and b.get('type') == 'tool_result':
                c = b.get('content')
                seq.append(('result', None, c if isinstance(c, str) else
                            ' '.join(x.get('text', '') for x in c or [] if isinstance(x, dict))))
    return seq


OPUS = ('opus', 'claude-opus-5-5')


def e2e_score(out, rcs=None, gate=None, label='checks'):
    """Every ship-e2e check from the kept run directory into <label>.json."""
    repo, origin = out / 'repo', out / 'origin.git'
    meta = json.loads((out / 'meta.json').read_text())
    base, pkg = meta['base'], meta['pkg']
    names = [n for n in ('run', 'run2', 'run3', 'run4') if (out / f'{n}.stdout').exists()]
    rcs = rcs or {n: json.loads((out / f'{n}.status.json').read_text())['exit'] for n in names}
    gate = gate or gate_rescore(out, base)
    events = {n: read_events(out / f'{n}.stdout') for n in names}
    per_run = {n: final_result(events[n]) for n in names}
    rows = [r for n in names for r in events[n]]
    seq = main_sequence(rows)
    uses = [(i, n, inp) for i, (kind, n, inp) in enumerate(seq) if kind == 'use']
    seat, facts = seat_checks(rows, E2E_PROFILES)
    seat['run_complete'] = all(rcs.get(n) == 0 for n in names) and all(
        r.get('subtype') == 'success' and not r.get('is_error') for r in per_run.values())
    seat['final_reply_names_no_profile_file'] = not any(PROFILE_RE.search(r.get('result') or '')
                                                        for r in per_run.values())
    final = per_run[names[-1]].get('result') or ''
    gate_reply = per_run['run'].get('result') or ''
    prs, calls = pr_state(out), gh_calls(out)
    heads = bare(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split()
    feature = prs[0]['headRefName'] if prs else next((h for h in heads if h != 'main' and not h.startswith('wave/')), None)
    # The feature branch is the one run 1 named at the gate, never main or a wave branch.
    feature_named = bool(feature) and feature != 'main' and not feature.startswith('wave/') and feature in gate_reply
    created = next((i for i, c in enumerate(calls) if c['argv'][:2] == ['pr', 'create'] and c['exit'] == 0), None)
    after = calls[created + 1:] if created is not None else []
    pr_idx = next((i for i, n, inp in uses if n == 'Bash' and 'gh pr create' in (inp.get('command') or '')), None)
    later = [(i, n, inp) for i, n, inp in uses if pr_idx is not None and i > pr_idx]
    later_bash = '\n'.join(inp.get('command') or '' for _, n, inp in later if n == 'Bash')
    scripts = [s_ for _, n, inp in uses if n == 'Bash' for s_ in launch_scripts(inp.get('command') or '')]
    # Run records wherever the session put them (`--out`), default or not.
    summaries = sorted(f for f in repo.glob('.worktrees/**/summary.json') if 'children' in f.read_text())
    children = [c.get('model') for f in summaries for c in json.loads(f.read_text()).get('children') or []]
    fix_commits = bare(origin, 'log', '--format=%H %s', f'{prs[0]["createdHeadOid"]}..{feature}').splitlines() \
        if prs and feature in heads else []
    changed = bare(origin, 'diff', '--name-only', f'main...{feature}').split() if feature in heads else []
    tests_rc = None
    if feature in heads:
        clone = Path(tempfile.mkdtemp(prefix=f'feature-clone-{label}-', dir=out))
        bench.call(['git', 'clone', '-q', '-b', feature, str(origin), str(clone / 'repo')])
        t = subprocess.run(TESTS, cwd=clone / 'repo', capture_output=True, text=True)
        (out / f'feature-tests-{label}.txt').write_text(t.stdout + t.stderr); tests_rc = t.returncode
    # The checkout's plan files (latest status), else the feature branch's.
    plan_texts = {str(f.relative_to(repo)): f.read_text() for f in repo.glob('docs/superpowers/plans/*.md')}
    if feature in heads:
        for rel in bare(origin, 'ls-tree', '-r', '--name-only', feature, '--', 'docs/superpowers/plans').split():
            plan_texts.setdefault(rel, bare(origin, 'show', f'{feature}:{rel}'))
    # A direct fix's independent check: an Agent on opus, started after a tool
    # result shows the last fix commit, whose prompt names that commit or the
    # commit the fixes start from. A wave launched after the pull request
    # supervises its own fixes.
    fix_checked = not fix_commits or any(n == 'Bash' and is_launch(inp.get('command') or '') for _, n, inp in later)
    if fix_commits and not fix_checked:
        last = fix_commits[0].split()[0]
        start = bare(origin, 'rev-parse', fix_commits[-1].split()[0] + '^')
        made = next((i for i, (kind, _, text) in enumerate(seq) if kind == 'result' and last[:7] in text), None)
        fix_checked = made is not None and any(
            n in ('Agent', 'Task') and inp.get('model') in OPUS and i > made
            and any(sha[:7] in (inp.get('prompt') or '') for sha in (last, start))
            for i, n, inp in uses)
    number = str(prs[0]['number']) if prs else None
    checks = {**seat, **gate,
              'no_stop_after_approval': names == ['run', 'run2'] and bool(prs) and 'Left behind:' in final,
              'branch_pushed': feature_named and feature in heads,
              'waves_by_snapshot_runner': bool(scripts) and bool(children)
                                          and all(in_package(s_, pkg) for s_ in scripts),
              'no_role_on_claude_fable_5_2': 'claude-fable-5-2' not in children
                                             and not any('claude-fable-5-2' in t for t in plan_texts.values()),
              'plan_done': bool(plan_texts) and all(re.search(r'(?m)^status: done\b', t)
                                                    for t in plan_texts.values()),
              'pr_opened_once': len(prs) == 1 and feature_named and prs[0]['baseRefName'] == 'main'
                                and prs[0]['headRefName'] == feature
                                and sum(c['argv'][:2] == ['pr', 'create'] and c['exit'] == 0 for c in calls) == 1,
              'pr_body_runtime_line': bool(prs) and 'Runtime pass:' in prs[0]['body'],
              # The session itself, not the host's own gh calls or a subagent:
              # its Skill call and its shell commands after the pull request.
              'review_protocol_ran': bool(prs)
                                     and any(n == 'Skill' and inp.get('skill') == 'code-review:critical-review'
                                             for _, n, inp in later)
                                     and all(s_ in later_bash for s_ in ('gh pr view', 'reviewThreads', 'gh pr diff'))
                                     and any(c['argv'][:2] == ['pr', 'view'] and number in c['argv'] for c in after)
                                     and any(c['argv'][:2] == ['api', 'graphql']
                                             and any('reviewThreads' in a for a in c['argv']) for c in after)
                                     and any(c['argv'][:2] == ['pr', 'diff'] for c in after),
              'direct_fix_checked_on_opus': fix_checked,
              'no_merge': bare(origin, 'rev-parse', 'main') == base
                          and not any(c['argv'][:2] == ['pr', 'merge'] for c in calls),
              'feature_tests_pass': tests_rc == 0,
              'scope': bool(changed) and all(E2E_SCOPE.match(f) for f in changed),
              'handoff_report': bool(prs) and prs[0]['url'] in final and 'Left behind:' in final
                                and 'Runtime pass:' in final,
              'handoff_asks_yes_no': bool(re.search(r'\?(?=\s|$)', final.strip().split('\n\n')[-1]))}
    # total_cost_usd of a resumed session is cumulative: each invocation's own
    # share is the difference from the last known total. An invocation without
    # a result (a timeout) has no cost of its own on record.
    costs, known = {}, 0.0
    for n in names:
        total = per_run[n].get('total_cost_usd')
        costs[n] = (total, None if total is None else total - known)
        known = known if total is None else total
    facts.update({'invocations': {n: {'rc': rcs.get(n), 'subtype': per_run[n].get('subtype'),
                                      'cost_usd_cumulative': costs[n][0], 'cost_usd': costs[n][1],
                                      'turns': sum(r.get('num_turns') or 0 for r in events[n]
                                                   if r.get('type') == 'result'),
                                      'seconds': json.loads((out / f'{n}.status.json').read_text())['seconds'],
                                      'usage': usage(events[n])} for n in names},
                  'seat_cost_usd': known,
                  'feature_branch': feature, 'feature_named_at_gate': feature_named, 'origin_heads': heads,
                  'runner_launches': len(scripts), 'runner_scripts': scripts,
                  'runner_records': [str(f.relative_to(repo)) for f in summaries],
                  'runner_children': children,
                  'agent_spawns': [{'model': inp.get('model'), 'description': inp.get('description'),
                                    'after_pr': i > pr_idx if pr_idx is not None else None}
                                   for i, n, inp in uses if n in ('Agent', 'Task')],
                  'gh_calls': [' '.join(c['argv'][:3]) + f' -> {c["exit"]}' for c in calls],
                  'pr': {k: prs[0].get(k) for k in ('url', 'title', 'headRefName', 'baseRefName', 'isDraft')}
                        if prs else None,
                  'pr_body_chars': len(prs[0]['body']) if prs else 0,
                  'pr_comments': len(prs[0]['comments']) if prs else 0,
                  'fix_commits_after_pr': fix_commits, 'changed_vs_main': changed,
                  'feature_tests_rc': tests_rc,
                  'plan_status': {k: next(iter(re.findall(r'(?m)^status: (\S+)', t)), None)
                                  for k, t in plan_texts.items()}})
    bench.dump(out / f'{label}.json', {'checks': checks, 'facts': facts})
    if prs:
        (out / 'pr-body.md').write_text(prs[0]['body'])
    (out / 'final.md').write_text(final)
    print(json.dumps({'checks': checks, 'facts': {k: v for k, v in facts.items() if k != 'invocations'},
                      'invocations': {n: {k: v for k, v in i.items() if k != 'usage'}
                                      for n, i in facts['invocations'].items()}},
                     ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--case', choices=['wave', 'ship', 'ship-e2e'])
    p.add_argument('--score', type=Path, help='Recompute the checks of a retained run directory: '
                   'every check with --case ship-e2e, the seat checks otherwise')
    p.add_argument('--profile', help='With --score: the profile(s) the session should read, comma-separated')
    p.add_argument('--model', default='claude-fable-5-2')
    p.add_argument('--supervisor', choices=['claude-fable-5-2'],
                   help='wave case: the approved plan names this premium supervisor (ADR 020)')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=10)
    p.add_argument('--timeout', type=int, default=2700, help='Seconds for the wave and ship cases')
    p.add_argument('--out', type=Path)
    p.add_argument('--prepare-only', action='store_true', help='Build and lint the fixture; no model call')
    args = p.parse_args()
    if args.score:
        if args.case == 'ship-e2e':
            return e2e_score(args.score.resolve(), label='checks-rescored')
        if not args.profile: p.error('--score requires --profile')
        return score(args.score.resolve(), args.profile)
    if not args.case or not args.out: p.error('--case and --out are required')
    out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, 'new', 'HEAD')
    if args.case == 'ship-e2e':
        return ship_e2e(args, out, pkg, versions)
    repo, _ = plan_live.fixture(out, 'interfaces')
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', '-b', 'main', str(origin)])
    bench.git(repo, 'remote', 'add', 'origin', str(origin))
    lint_out = ''
    if args.case == 'wave':
        plan = repo / PLAN_REL; plan.parent.mkdir(parents=True)
        plan.write_text(wave_plan(args.supervisor))
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
        role_check = ({'supervisor_on_claude_fable_5_2': 'a judge child runs on claude-fable-5-2 and no executor does'}
                      if args.supervisor else {'no_role_on_claude_fable_5_2': True})
        expected = {'case': 'wave', **seat,
                    'runner_launched': "the snapshot's claude-wave-runner.mjs",
                    **role_check,
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
    expected.update(seat_model=args.model, effort=args.effort, supervisor=args.supervisor)
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
    runner_calls = [c for c in commands if is_launch(c)]
    scripts = [s_ for c in commands for s_ in launch_scripts(c)]
    checks['run_complete'] = checks['run_complete'] and rc == 0
    if args.case == 'wave':
        entries = [c for f in sorted(repo.glob('.worktrees/**/summary.json'))
                   for c in json.loads(f.read_text()).get('children') or []]
        children = [c.get('model') for c in entries]
        facts['runner_children'] = children
        facts['runner_child_roles'] = [(c.get('role'), c.get('model')) for c in entries]
        checks['runner_launched_from_snapshot'] = bool(scripts) and bool(children) and \
            all(in_package(s_, pkg) for s_ in scripts)
        if args.supervisor:
            checks['supervisor_on_claude_fable_5_2'] = \
                any(c.get('model') == args.supervisor and c.get('role') != 'exec' for c in entries) and \
                not any(c.get('model') == args.supervisor and c.get('role') == 'exec' for c in entries)
        else:
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
