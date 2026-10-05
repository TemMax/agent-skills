#!/usr/bin/env python3
"""Manual, bounded real-host regression probes. No model calls under --prepare-only.

Native recovery fault: the transparent CLI adapter removes a disposable machine
marker only after the real executor exits. Commands are unchanged and transcripts
come from the real CLI. Old Claude uses the actual Workflow tool; its fault is
injected when the verifier checkout is registered, after the executor committed.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import threading
import uuid
from claude_session_events import read_events, final_result, skill_loads
from importlib.util import spec_from_file_location, module_from_spec

ROOT = Path(__file__).resolve().parents[2]


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')


def call(cmd, cwd=None, **kwargs):
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{cmd[0]} failed ({result.returncode}): '+result.stderr[-3000:]+result.stdout[-3000:])
    return result.stdout.strip()


def git(repo, *args):
    return call(['git', '-C', str(repo), *args], timeout=30)


def snapshot(out, arm, ref):
    pkg = out / 'package'
    if arm == 'new':
        for name in ('orchestration', 'code-review'):
            shutil.copytree(ROOT / 'plugins' / name, pkg / 'plugins' / name,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    else:
        archive = subprocess.check_output(['git', '-C', str(ROOT), 'archive', ref, 'plugins/orchestration', 'plugins/code-review'])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(pkg, filter='data')
    marketplace = 'cost-live-'+arm+'-'+str(time.time_ns())
    (pkg / '.agents/plugins').mkdir(parents=True)
    dump(pkg / '.agents/plugins/marketplace.json', {'name': marketplace, 'plugins': [
        {'name': name, 'source': {'source': 'local', 'path': './plugins/'+name},
         'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'}, 'category': 'Productivity'}
        for name in ('orchestration', 'code-review')]})
    hashes = {str(p.relative_to(pkg)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(pkg.rglob('*')) if p.is_file()}
    versions = {name: json.loads((pkg / 'plugins' / name / '.claude-plugin/plugin.json').read_text())['version']
                for name in ('orchestration', 'code-review')}
    dump(out / 'snapshot.json', hashes)
    return pkg, marketplace, versions


def fixture(out, case, provider):
    repo = out / 'repo'
    (repo / 'src').mkdir(parents=True)
    (repo / 'tests').mkdir()
    (repo / 'src/__init__.py').write_text('')
    (repo / '.gitignore').write_text('.worktrees/\n__pycache__/\n*.pyc\n')
    if case == 'semantic':
        (repo / 'src/validator.py').write_text('def validate(value):\n    if value < 0:\n        raise ValueError("negative values forbidden")\n    return int(value)\n')
        tests = 'import unittest\nfrom src.validator import validate\n\nclass Tests(unittest.TestCase):\n'
        tests += ''.join(f'    def test_positive_{i}(self):\n        self.assertEqual(validate({i}), {i})\n' for i in range(39))
        (repo / 'tests/test_validator.py').write_text(tests)
    else:
        (repo / 'src/calc.py').write_text('def divide(a, b):\n'+('    if b == 0:\n        return None\n' if case == 'navigation' else '')+'    return a / b\n')
        (repo / 'tests/test_calc.py').write_text('import unittest\nfrom src.calc import divide\n\nclass Tests(unittest.TestCase):\n    def test_divide(self):\n        self.assertEqual(divide(6, 3), 2)\n    def test_zero(self):\n        self.assertIsNone(divide(1, 0))\n')
    (repo / 'README.md').write_text('# Fixture\nSmall arithmetic package.\n')
    (repo / 'AGENTS.md').write_text('Read README.md before changing the repository. Do not create a PR.\n')
    if case == 'navigation':
        (repo / '.github/workflows').mkdir(parents=True)
        (repo / '.github/workflows/ci.yml').write_text('name: ci\non: [push]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: python3 -B -m unittest discover -s tests\n')
    git(repo, 'init', '-b', 'main')
    for k, v in [('user.name', 'Live fixture'), ('user.email', 'fixture@example.invalid'), ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
        git(repo, 'config', k, v)
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Frozen fixture')
    base = git(repo, 'rev-parse', 'HEAD')
    origin = out / 'origin.git'
    call(['git', 'init', '--bare', str(origin)], timeout=30)
    git(repo, 'remote', 'add', 'origin', str(origin)); git(repo, 'push', '-u', 'origin', 'main')
    if case == 'semantic':
        git(repo, 'checkout', '-b', 'wave/one')
        (repo / 'src/validator.py').write_text('def validate(value):\n    return int(value)\n')
        git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Simplify conversion')
    elif case == 'navigation':
        git(repo, 'checkout', '-b', 'docs/ci-explanation')
        (repo / 'README.md').write_text((repo / 'README.md').read_text()+'\nCI runs the unit tests with a ten-minute timeout. This PR only documents existing behavior.\n')
        git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Document existing CI behavior')
        (out / 'pr-context.md').write_text('Fixture PR #17\nDescription: Explain existing CI behavior in README.\nDiscussion: No CI change is included; the timeout remains ten minutes.\nBase: '+base+'\nHead: '+git(repo, 'rev-parse', 'HEAD')+'\n')
    else:
        (out / 'machine-ready').write_text('ready\n')
        # The machine check is external to committed product code, so verification is never cached.
        command = f'test -f {out}/machine-ready || {{ echo "SDK location not found: injected fixture environment"; exit 2; }}; python3 -B -m unittest discover -s tests'
        executor = 'claude-haiku-4-5-20251001' if provider == 'claude' else 'gpt-6-luna'
        supervisor = 'claude-opus-5-5' if provider == 'claude' else 'gpt-6.1-sol'
        plan = {'waves': [{'wave': 1, 'limits': {'max_attempts': 1, 'max_model_calls': 2},
            'supervisor': {'model': supervisor, 'effort': 'high'},
            'tasks': [{'id': 'one', 'branch': 'wave/one', 'executor': {'model': executor, 'effort': 'medium'},
                'ladder': [], 'contract': {'files_allowed': ['src/**'], 'files_forbidden': ['tests/**', 'AGENTS.md'],
                'must_run': [{'cmd': command, 'evidence': 'required'}],
                'forbidden_moves': ['Do not weaken, delete or skip existing tests'],
                'report_must_answer': ['How is division by zero handled?']}}]}],
            'ci': 'none: disposable fixture has no CI', 'e2e': 'not-applicable: no user interface'}
        (out / 'plan.md').write_text('status: draft\nbase: pending\n\n```json wave-plan\n'+json.dumps(plan, indent=2)+'\n```\n\n## Task one\n\nAdd a guard in src/calc.py: divide(a, 0) must return None; other division remains unchanged. Keep tests unchanged.\n')
    return repo, base


def register_workspace_skills(repo, pkg):
    registry = repo / '.agents/skills'
    registry.mkdir(parents=True)
    for plugin, kind in [('orchestration', 'multi-model'), ('code-review', 'critical-review')]:
        source = pkg / 'plugins' / plugin / 'skills-codex' / kind
        (registry / kind).symlink_to(source, target_is_directory=True)


def candidate_read_matches(paths, expected, repo):
    expected = expected.resolve()
    digest = hashlib.sha256(expected.read_bytes()).hexdigest()
    for raw in paths:
        path = Path(raw)
        if not path.is_absolute():
            path = repo / path
        if (path.is_file() and path.resolve() == expected
                and hashlib.sha256(path.read_bytes()).hexdigest() == digest):
            return True
    return False


def workflow_reads(out):
    reads = []
    for path in sorted(out.glob('turn-*.jsonl')):
        for row in read_events(path):
            item = row.get('item') or {}
            if row.get('type') == 'item.completed' and item.get('type') == 'command_execution':
                command = item.get('command', '')
                if 'WORKFLOW.md' in command:
                    reads.append(command)
            if row.get('type') == 'assistant':
                for block in (row.get('message') or {}).get('content', []):
                    if isinstance(block, dict) and block.get('type') == 'tool_use':
                        args = block.get('input') or {}
                        target = args.get('file_path', '') if block.get('name') == 'Read' else args.get('command', '')
                        if 'WORKFLOW.md' in target:
                            reads.append(target)
    return reads


def workflow_body_loaded(out, expected, provider):
    body = expected.read_text().strip()
    read_ids = set()
    for path in sorted(out.glob('turn-*.jsonl')):
        for row in read_events(path):
            item = row.get('item') or {}
            if provider == 'codex' and row.get('type') == 'item.completed' and item.get('type') == 'command_execution':
                if body in item.get('aggregated_output', ''):
                    return True
            for block in (row.get('message') or {}).get('content', []):
                if not isinstance(block, dict):
                    continue
                if block.get('type') == 'tool_use' and block.get('name') == 'Read':
                    target = Path((block.get('input') or {}).get('file_path', ''))
                    if target.resolve() == expected.resolve():
                        read_ids.add(block.get('id'))
                if block.get('type') == 'tool_result' and block.get('tool_use_id') in read_ids and not block.get('is_error'):
                    content = block.get('content', '')
                    if isinstance(content, str) and body in re.sub(r'(?m)^\s*\d+\t', '', content):
                        return True
    return False


def navigation(out, repo, base, pkg, marketplace, versions, provider, cli):
    # Same continuation decisions and fixture for both hosts. Only invocation syntax differs.
    skill = 'orchestration:multi-model' if provider == 'claude' else '$multi-model'
    prompts = [f'Объясни по-русски, что изменил этот PR. Его описание и обсуждение: {out}/pr-context.md. '
               f'Репозиторий здесь, base={base}, head=docs/ci-explanation. Нужен краткий рассказ о фактических изменениях. Файлы не меняй.',
               f'Теперь используй скилл {skill}. Только прочитай README.md и .github/workflows/ci.yml и назови текущий timeout-minutes. Файлы не меняй, агентов не запускай.',
               f'Примени тот же скилл {skill} ещё раз к продолжению задачи. Одиночная правка уже одобрена: '
               'в .github/workflows/ci.yml замени timeout-minutes с 10 на 15. Сделай сам и проверь результат. Не коммить и не открывай PR.',
               'Да, продолжай в том же согласованном объёме.']
    original = {str(p.relative_to(repo)): p.read_bytes() for p in repo.rglob('*')
                if p.is_file() and not any(x in p.parts for x in ('.git', '__pycache__', '.agents'))}
    head = git(repo, 'rev-parse', 'HEAD')
    sid = str(uuid.uuid4()) if provider == 'claude' else None
    if provider == 'claude':
        common = [cli, '-p', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-5-5', '--effort', 'medium',
                  '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill',
                  '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                  '--add-dir', str(out), '--plugin-dir', str(pkg / 'plugins/orchestration'), '--plugin-dir', str(pkg / 'plugins/code-review')]
    else:
        # Native workspace skill discovery: a disposable registry, no plugin add,
        # remove, marketplace switch, installed cache writes or configuration edits.
        register_workspace_skills(repo, pkg)
        common = [cli, '--ignore-user-config', '--json', '--skip-git-repo-check',
                  '--disable', 'plugins', '--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="medium"',
                  '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false']
    completed, costs = True, 0.0
    for k, prompt in enumerate(prompts, 1):
        if provider == 'claude':
            if costs >= 3:
                completed = False; break
            cmd = common+['--max-budget-usd', str(3-costs)]+(['--session-id', sid] if k == 1 else ['--resume', sid])
        elif k == 1:
            cmd = [cli, 'exec', *common[1:], '-C', str(repo), '--sandbox', 'workspace-write', '--add-dir', str(out), '-']
        else:
            cmd = [cli, 'exec', 'resume', *common[1:], '-c', 'sandbox_mode="workspace-write"', sid, '-']
        print(f'navigation {k}/4', flush=True)
        rc = run_logged(cmd, out, f'turn-{k}', cwd=repo, prompt=prompt, timeout=150)
        shutil.copyfile(out / f'turn-{k}.stdout', out / f'turn-{k}.jsonl')
        rows = read_events(out / f'turn-{k}.jsonl')
        if provider == 'claude':
            result = final_result(rows)
            done = result.get('subtype') == 'success' and not result.get('is_error')
            if result.get('total_cost_usd') is None:
                done = False
            else:
                costs += result['total_cost_usd']
        else:
            if k == 1:
                sid = next((r.get('thread_id') for r in rows if r.get('type') == 'thread.started'), None)
            done = any(r.get('type') == 'turn.completed' for r in rows) and bool(sid)
        if rc != 0 or not done:
            completed = False; break
    (out / 'meta.txt').write_text(f'arm={json.loads((out / "meta.json").read_text())["arm"]}\nthread_id={sid}\n')
    spec = spec_from_file_location('claude_bench', ROOT / 'tests/eval/claude-skill-session-ab.py')
    module = module_from_spec(spec); spec.loader.exec_module(module)
    if provider == 'claude':
        module.capture_transcripts(out, sid, Path.home() / '.claude/projects')
        from claude_session_events import analyze
        metrics = analyze(out)
        rows = [r for p in sorted(out.glob('turn-*.jsonl')) for r in read_events(p)]
        load_paths = skill_loads(rows)
        body = (pkg / 'plugins/orchestration/skills/multi-model/SKILL.md').read_text().split('---', 2)[2].strip()
        injections = [b.get('text', '') for r in rows if r.get('type') == 'user'
                      for b in (r.get('message') or {}).get('content', []) if isinstance(b, dict) and b.get('type') == 'text']
        candidate_loaded = any(t.startswith('Base directory for this skill: '+str(pkg / 'plugins/orchestration/skills/multi-model')+'\n')
                               and t.split('\n', 1)[1].strip() == body for t in injections)
        loads_after_first = sum(len(skill_loads(read_events(p))) for p in sorted(out.glob('turn-[34].jsonl')))
    else:
        sessions = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'sessions'
        if sid:
            match = next(sessions.glob(f'**/rollout-*-{sid}.jsonl'), None)
            if match: shutil.copyfile(match, out / 'rollout.jsonl')
        spec = spec_from_file_location('codex_bench', ROOT / 'tests/eval/skill-session-ab-analyze.py')
        analyzer = module_from_spec(spec); spec.loader.exec_module(analyzer)
        metrics = analyzer.analyze_run(str(out))
        load_paths = [p for t in metrics['per_turn'] for p in t['lists'].get('skill_reads_full', [])]
        candidate_loaded = candidate_read_matches(load_paths, pkg / 'plugins/orchestration/skills-codex/multi-model/SKILL.md', repo)
        loads_after_first = sum(t.get('skill_reads_full_mm', 0)+t.get('skill_reads_ranged_mm', 0) for t in metrics['per_turn'] if t['turn'] >= 3)
    expected_ci = original['.github/workflows/ci.yml'].replace(b'timeout-minutes: 10', b'timeout-minutes: 15')
    final_paths = {str(p.relative_to(repo)) for p in repo.rglob('*') if p.is_file()
                   and not any(x in p.parts for x in ('.git', '__pycache__', '.worktrees', '.agents'))}
    s = metrics['summary']
    checks = {'dialog_completed': completed, 'candidate_loaded_normally': candidate_loaded,
              'one_line_ci_edit': (repo / '.github/workflows/ci.yml').read_bytes() == expected_ci,
              'other_files_unchanged': final_paths == set(original) and all((repo / p).read_bytes() == value for p, value in original.items() if p != '.github/workflows/ci.yml'),
              'no_commit': git(repo, 'rev-parse', 'HEAD') == head,
              'no_profile_announcements': s['announce'] == 0,
              'no_reapproval': s['gates'] == 0,
              'no_skill_reload_on_continuation': loads_after_first == 0,
              'no_native_children': s['native_spawns'] == 0}
    if json.loads((out / 'meta.json').read_text())['arm'] == 'new':
        checks['no_delegation_workflow_for_standalone_edit'] = not workflow_reads(out)
    # Old announcements/read behavior is a measured baseline, not a product pass criterion for that arm.
    old = json.loads((out / 'meta.json').read_text())['arm'] == 'old'
    required = [value for key, value in checks.items() if not (old and key in ['no_profile_announcements', 'no_reapproval', 'no_skill_reload_on_continuation'])]
    dump(out / 'loaded-candidate.json', {'paths': load_paths, 'versions': versions, 'candidate_loaded': candidate_loaded})
    return {'passed': all(required), 'checks': checks, 'metrics': s, 'skill_loads_after_first': loads_after_first}


def adapter(out, cli, provider, pkg, max_calls=6, inject_fault=True):
    """Transparent real-CLI transport plus deterministic post-executor fault."""
    path = out / 'real-cli-adapter'
    path.write_text('''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys, time
config=json.loads(pathlib.Path(__file__).with_name('adapter.json').read_text())
a=sys.argv[1:]
root=pathlib.Path(__file__).parent
if config['provider']=='codex' and a and a[0]=='sandbox':
    # Preflight runs a local command through sandbox, not a model. Pass it
    # unchanged and keep it outside the paid-call cap and role accounting.
    sys.exit(subprocess.run([config['cli'], *a]).returncode)
role='judge' if '--json-schema' in a or '--output-schema' in a else 'exec'
log=root/'calls.jsonl'
rows=log.read_text().splitlines() if log.exists() else []
if len(rows)>=config['max_calls']:
    print('fixture cumulative call cap exhausted',file=sys.stderr); sys.exit(75)
start=time.time()
argv=[config['cli'], *a]
if config['provider']=='claude':
    argv+=['--max-budget-usd','2','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--plugin-dir',config['plugin']]
else:
    argv+=['--disable','plugins']
record={'role':role,'argv':argv,'cwd':os.getcwd(),'started':start}
with log.open('a') as f:f.write(json.dumps(record)+'\\n')
env=dict(os.environ);env.pop('CLAUDECODE',None)
r=subprocess.run(argv,env=env)
if config['inject_fault'] and role=='exec' and r.returncode==0 and not (root/'fault-fired').exists():
    (root/'machine-ready').unlink(missing_ok=True)
    (root/'fault-fired').write_text('fault after real executor exit\\n')
with (root/'transport-results.jsonl').open('a') as f:f.write(json.dumps({'role':role,'exit':r.returncode,'seconds':time.time()-start})+'\\n')
sys.exit(r.returncode)
''')
    path.chmod(0o700)
    dump(out / 'adapter.json', {'cli': cli, 'provider': provider, 'max_calls': max_calls, 'inject_fault': inject_fault,
         'plugin': str(pkg / 'plugins/orchestration')})
    return path


def run_logged(cmd, out, name, cwd=None, prompt=None, timeout=420):
    dump(out / (name+'.argv.json'), cmd)
    if prompt is not None:
        (out / (name+'.prompt')).write_text(prompt)
    started = time.monotonic()
    with (out / (name+'.stdout')).open('w') as stdout, (out / (name+'.stderr')).open('w') as stderr:
        env = dict(os.environ); env.pop('CLAUDECODE', None)
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                text=True, env=env, start_new_session=True)
        try:
            proc.communicate(prompt, timeout=timeout)
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(proc.pid, signal.SIGTERM)
            try: proc.wait(timeout=3)
            except subprocess.TimeoutExpired: pass
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait(); rc = 124
    dump(out / (name+'.status.json'), {'exit': rc, 'seconds': time.monotonic()-started})
    return rc


def handoff(out, repo, base, pkg, provider, cli):
    """Real coordinator discovers the skill and runs one approved supervised task."""
    transport = adapter(out, cli, provider, pkg, max_calls=2, inject_fault=False)
    plan = out / 'plan.md'
    plan.write_text(plan.read_text().replace('status: draft\nbase: pending', 'status: active\nbase: '+base))
    if provider == 'codex':
        register_workspace_skills(repo, pkg)
        with (repo / '.git/info/exclude').open('a') as f:
            f.write('\n.agents/\n')
    skill = 'orchestration:multi-model' if provider == 'claude' else '$multi-model'
    prompt = (f'Используй скилл {skill} для выполнения уже согласованной единственной волны: '
        f'план {plan}, wave=1, repo={repo}, base={base}, default-branch=main. '
        'Точные роли, effort, контракт, доступ к этой одноразовой фикстуре и лимит два дочерних вызова уже одобрены. '
        'План не меняй, новых согласований не нужно. Используй штатный native runner из загруженного кандидата, '
        f'с параметрами --{provider} {transport}, --out {out}/wave, --jobs 1, --timeout-min 2. '
        'Не пиши код задачи сам, не запускай дополнительные агенты и не меняй настройки git. '
        'Остановись после summary runner: без интеграции, публикации, PR или повторного запуска. '
        'Запуск координатора находится вне sandbox; дочерние CLI сохраняют собственные sandbox. '
        'Фикстура не содержит секретов. Дай короткий результат по-русски.')
    if provider == 'claude':
        cmd = [cli, '-p', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-5-5', '--effort', 'medium',
            '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--allowedTools', 'Read,Glob,Grep,Bash,Skill',
            '--max-budget-usd', '2', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--add-dir', str(out), '--plugin-dir', str(pkg / 'plugins/orchestration')]
    else:
        # Match the existing ship-smoke coordinator transport: macOS Seatbelt
        # cannot nest. The native runner still sandboxes each actual child.
        cmd = [cli, 'exec', '--ignore-user-config', '--disable', 'plugins', '--json', '--skip-git-repo-check',
            '-C', str(repo), '--sandbox', 'danger-full-access', '--model', 'gpt-6.1-sol',
            '-c', 'model_reasoning_effort="medium"', '-c', 'memories.use_memories=false', '-']
    rc = run_logged(cmd, out, 'turn-1', cwd=repo, prompt=prompt, timeout=360)
    shutil.copyfile(out / 'turn-1.stdout', out / 'turn-1.jsonl')
    summary_path = out / 'wave/summary.json'
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    calls = read_events(out / 'calls.jsonl') if (out / 'calls.jsonl').exists() else []
    workflow = pkg / 'plugins/orchestration' / ('skills' if provider == 'claude' else 'skills-codex') / 'multi-model/WORKFLOW.md'
    checks = {'coordinator_completed': rc == 0, 'mandatory_workflow_loaded': workflow_body_loaded(out, workflow, provider),
        'one_executor_one_reviewer': [c['role'] for c in calls] == ['exec', 'judge'],
        'native_wave_accepted': summary.get('status') == ('done' if provider == 'claude' else 'merge-ready'),
        'main_unchanged': git(repo, 'rev-parse', 'HEAD') == base,
        'signing_config_unchanged': git(repo, 'config', 'commit.gpgsign') == 'false'}
    branch = git(repo, 'show', 'wave/one:src/calc.py') if calls else ''
    checks['task_guard_present'] = 'return None' in branch
    dump(out / 'loaded-workflow.json', {'reads': workflow_reads(out), 'snapshot': str(out / 'snapshot.json')})
    return {'passed': all(checks.values()), 'checks': checks, 'summary': str(summary_path), 'calls': len(calls)}


def recovery(out, repo, base, pkg, provider, arm, cli):
    refs = pkg / 'plugins/orchestration/skills/multi-model/references'
    transport = adapter(out, cli, provider, pkg)
    if arm == 'old' and provider == 'claude':
        return old_claude_recovery(out, repo, base, pkg, cli)
    common = ['node', str(refs / (provider+'-wave-runner.mjs')), '--plan', str(out / 'plan.md'), '--wave', '1',
              '--repo', str(repo), '--base', base, '--'+provider, str(transport),
              '--jobs', '1', '--timeout-min', '2', '--preflight', 'off']
    if provider == 'claude':
        common += ['--default-branch', 'main']
    print('first wave: real executor, then injected environment failure', flush=True)
    first_rc = run_logged(common+['--out', str(out / 'first')], out, 'first-run')
    first_path = out / 'first/summary.json'
    if not first_path.exists():
        return {'passed': False, 'blocked': 'First run has no recovery summary', 'exit': first_rc}
    first = json.loads(first_path.read_text())
    head = git(repo, 'rev-parse', 'wave/one')
    if head == base or first_rc == 0:
        return {'passed': False, 'error': 'Fault did not leave a committed, rejected candidate', 'first': first}
    (out / 'machine-ready').write_text('repaired\n')
    if arm == 'old':
        # Reset only the explicitly disposable baseline fixture; retain its original evidence.
        shutil.copytree(out / 'first', out / 'preserved-first')
        rc = run_logged(['node', str(refs / 'codex-wave-runner.mjs'), '--reset', '--plan', str(out / 'plan.md'),
                        '--wave', '1', '--repo', str(repo), '--base', base, '--out', str(out / 'first')], out, 'baseline-reset')
        if rc:
            return {'passed': False, 'blocked': 'Old baseline reset failed', 'exit': rc}
        resume_args = []
    else:
        resume_args = ['--resume-from', str(first_path)]
    print('environment repaired: continue candidate', flush=True)
    second_rc = run_logged(common+['--out', str(out / 'resumed'), *resume_args], out, 'resume-run')
    second_path = out / 'resumed/summary.json'
    if not second_path.exists():
        return {'passed': False, 'blocked': 'Continuation has no summary', 'exit': second_rc}
    second = json.loads(second_path.read_text())
    calls = [json.loads(line) for line in (out / 'calls.jsonl').read_text().splitlines()]
    executor_calls = sum(c['role'] == 'exec' for c in calls)
    judge_calls = sum(c['role'] == 'judge' for c in calls)
    checks = {'first_stopped': first_rc != 0, 'continuation_accepted': second_rc == 0,
              'expected_executor_calls': executor_calls == (1 if arm == 'new' else 2),
              'judge_present': judge_calls >= 1,
              'candidate_preserved': git(repo, 'rev-parse', 'wave/one') == head if arm == 'new' else True}
    if arm == 'new' and second_rc == 0:
        # Already at the two-call cap. Continuing its latest receipt may verify but must launch no model.
        before = len(calls)
        cap_rc = run_logged(common+['--out', str(out / 'capped'), '--resume-from', str(second_path)], out, 'cap-run')
        after = len((out / 'calls.jsonl').read_text().splitlines())
        checks.update(cap_not_reset=cap_rc != 0 and after == before)
    return {'passed': all(checks.values()), 'checks': checks, 'executor_calls': executor_calls,
            'judge_calls': judge_calls, 'first_head': head, 'final_head': git(repo, 'rev-parse', 'wave/one'),
            'summaries': [str(first_path), str(second_path)]}


def old_claude_recovery(out, repo, base, pkg, cli):
    refs = pkg / 'plugins/orchestration/skills/multi-model/references'
    script = repo / '.worktrees/launch/old-wave.workflow.mjs'
    call(['node', str(refs / 'wave-launch.mjs'), str(out / 'plan.md'), '--wave', '1', '--repo', str(repo),
          '--base', base, '--default-branch', 'main', '--out', str(script)], timeout=60)
    sid = str(uuid.uuid4())
    common = [cli, '-p', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-5-5',
              '--effort', 'medium', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
              '--allowedTools', 'Read,Write,Glob,Grep,Bash,Workflow', '--max-budget-usd', '3',
              '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
              '--add-dir', str(out),
              '--plugin-dir', str(pkg / 'plugins/orchestration')]
    stopped = threading.Event()
    def fault():
        # Metadata is created before git checks out files. A blocked first verifier
        # is required evidence; a missed fault cannot be called a pass.
        target = repo / '.git/worktrees/verify-one'
        while not stopped.wait(0.001):
            if target.exists():
                (out / 'machine-ready').unlink(missing_ok=True)
                (out / 'fault-fired').write_text('fault at old Workflow verifier checkout\n')
                return
    watcher = threading.Thread(target=fault, daemon=True); watcher.start()
    first_prompt = ('Execute the approved single-task wave using the actual Workflow tool. '
        f'Call Workflow with scriptPath {script}, with no args and no resumeFromRunId. '
        'Do not reimplement the script, do not run its tasks yourself, do not change the plan, and do not start another Workflow call. '
        'The task, non-premium role routes and local access are approved. No planning questions or PR. '
        f'After the tool returns, copy its exact returned result object to {out}/workflow-first.json using Write, then stop. '
        'An environment block is a valid terminal result for this run; do not repair or retry it.')
    print('old Claude: actual Workflow tool with a verification-time fault', flush=True)
    first_rc = run_logged(common+['--session-id', sid], out, 'workflow-first', cwd=repo, prompt=first_prompt, timeout=300)
    stopped.set(); watcher.join(timeout=2)
    first_file = out / 'workflow-first.json'
    head = git(repo, 'rev-parse', 'wave/one')
    if not first_file.exists() or head == base or not (out / 'fault-fired').exists():
        return {'passed': False, 'error': 'Old Workflow did not expose the expected committed environment block', 'exit': first_rc}
    first = json.loads(first_file.read_text())
    # Require a tool-origin trace too; a coordinator's invented summary cannot establish this flow.
    rows = read_events(out / 'workflow-first.stdout')
    tool_calls = [b for r in rows if r.get('type') == 'assistant' for b in (r.get('message') or {}).get('content', [])
                  if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'Workflow']
    if len(tool_calls) != 1 or 'environment-blocked' not in json.dumps(first):
        return {'passed': False, 'error': 'Expected one actual Workflow call and its environment-blocked result', 'first': first}
    (out / 'machine-ready').write_text('repaired\n')
    second_prompt = (f'The fixture environment is repaired. Start one fresh Workflow call with the SAME scriptPath {script}, '
        'no args and no resumeFromRunId. This measures the old full-wave rerun strategy, not receipt recovery. '
        'Do not change the script, plan, branch, worktree or product yourself. All roles/access remain approved. '
        f'Copy the exact returned result object to {out}/workflow-resumed.json using Write, then stop. No PR.')
    second_rc = run_logged(common+['--resume', sid], out, 'workflow-resumed', cwd=repo, prompt=second_prompt, timeout=360)
    second_file = out / 'workflow-resumed.json'
    if not second_file.exists():
        return {'passed': False, 'error': 'Old Workflow rerun produced no result', 'exit': second_rc}
    second = json.loads(second_file.read_text())
    spec = spec_from_file_location('claude_bench', ROOT / 'tests/eval/claude-skill-session-ab.py')
    module = module_from_spec(spec); spec.loader.exec_module(module)
    module.capture_transcripts(out, sid, Path.home() / '.claude/projects')
    roles = []
    for path in (out / 'child-rollouts').rglob('agent-*.jsonl'):
        child_rows = read_events(path)
        first_user = next((r.get('message', {}).get('content') for r in child_rows if r.get('type') == 'user'), '')
        text = json.dumps(first_user, ensure_ascii=False)
        role = 'verify' if '# Mechanical verification (facts only)' in text else ('exec' if '# Task: one' in text else 'judge')
        roles.append({'role': role, 'path': str(path)})
    dump(out / 'workflow-children.json', roles)
    checks = {'real_workflow_first': len(tool_calls) == 1,
              'first_environment_blocked': 'environment-blocked' in json.dumps(first),
              'rerun_accepted': second_rc == 0 and second.get('status') == 'done',
              'candidate_present': git(repo, 'rev-parse', 'wave/one') != base,
              'child_usage_captured': bool(roles)}
    return {'passed': all(checks.values()), 'checks': checks, 'first_head': head,
            'final_head': git(repo, 'rev-parse', 'wave/one'), 'session_id': sid,
            'strategy': 'old full Workflow rerun; not an optimal-resume claim',
            'workflow_children': roles, 'first_result': first, 'second_result': second}


VERDICT_SCHEMA = {'type': 'object', 'additionalProperties': False, 'properties': {
    'ok': {'type': 'boolean'}, 'violations': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
        'properties': {'rule': {'type': 'string'}, 'class': {'type': 'string', 'enum': ['files', 'must_run', 'forbidden-move', 'report', 'environment']},
            'evidence': {'type': 'string'}, 'satisfiable': {'type': ['boolean', 'null']}},
        'required': ['rule', 'class', 'evidence', 'satisfiable']}}, 'remarks': {'type': 'array', 'items': {'type': 'string'}}},
    'required': ['ok', 'violations', 'remarks']}


def semantic(out, repo, base, pkg, provider, cli):
    refs = pkg / 'plugins/orchestration/skills/multi-model/references'
    must_run = 'python3 -B -m unittest discover -s tests'
    contract = {'files_allowed': ['src/**'], 'files_forbidden': ['tests/**'], 'must_run': [{'cmd': must_run, 'evidence': 'required'}],
                'forbidden_moves': ['Do not remove or weaken validation that rejects negative input at BASE'],
                'report_must_answer': ['Does the existing rejection of negative values remain intact?']}
    request = {'repo': str(repo), 'branch': 'wave/one', 'base': base, 'contract': contract,
               'report': 'Simplified conversion. All 39 tests pass. Existing validation remains intact.',
               'logDir': str(out / 'verification-logs'), 'timeoutMs': 30000}
    # Baseline facts use the same independent code verifier as the candidate;
    # only the supervisor prompt differs. This isolates prompt behavior, not old pipeline cost.
    verifier = ROOT / 'plugins/orchestration/skills/multi-model/references/mechanical-verify.mjs'
    dump(out / 'verification.request.json', request)
    call(['node', str(verifier), '--request', str(out / 'verification.request.json'), '--output', str(out / 'verification.json')], timeout=90)
    facts = json.loads((out / 'verification.json').read_text())
    facts.pop('pipeline', None)
    if any(m['exit'] != 0 for m in facts['mustRun']):
        return {'passed': False, 'error': 'Planted semantic case does not have green mechanical checks'}
    checkout = out / 'judge-checkout'
    head = git(repo, 'rev-parse', 'wave/one')
    git(repo, 'worktree', 'add', '--detach', str(checkout), head)
    before = git(checkout, 'status', '--porcelain')
    prompt = (refs / 'supervisor-prompt.md').read_text()+'\n\nCONTRACT:\n'+json.dumps(contract)+'\nREPO: '+str(repo)+'\nBASE: '+base+'\nBRANCH: wave/one\nVERIFIER FACTS:\n'+json.dumps(facts)+'\nREPORT:\n'+request['report']
    dump(out / 'verdict.schema.json', VERDICT_SCHEMA)
    if provider == 'claude':
        cmd = [cli, '-p', '--model', 'claude-opus-5-5', '--effort', 'high', '--no-session-persistence',
               '--output-format', 'json', '--json-schema', json.dumps(VERDICT_SCHEMA), '--tools', 'Read,Glob,Grep,Bash',
               '--allowedTools', 'Read,Glob,Grep,Bash', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
               '--max-budget-usd', '2', '--setting-sources', '', '--plugin-dir', str(pkg / 'plugins/orchestration')]
    else:
        cmd = [cli, 'exec', '--ephemeral', '--skip-git-repo-check', '-C', str(checkout), '--sandbox', 'workspace-write',
               '--add-dir', str(repo), '--disable', 'plugins', '--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"',
               '--output-schema', str(out / 'verdict.schema.json'), '--json', '-o', str(out / 'verdict.json'), '-']
    rc = run_logged(cmd, out, 'judge', cwd=checkout, prompt=prompt, timeout=150)
    if provider == 'claude':
        envelope = json.loads((out / 'judge.stdout').read_text())
        verdict = envelope.get('structured_output') or {}
        dump(out / 'verdict.json', verdict)
    else:
        verdict = json.loads((out / 'verdict.json').read_text()) if (out / 'verdict.json').exists() else {}
    unchanged = git(checkout, 'status', '--porcelain') == before and git(checkout, 'rev-parse', 'HEAD') == head and git(repo, 'rev-parse', 'wave/one') == head
    rejected = verdict.get('ok') is False and any(v.get('class') == 'forbidden-move' and v.get('evidence') for v in verdict.get('violations', []))
    return {'passed': rc == 0 and unchanged and rejected, 'mechanical_green': True, 'test_count': 39,
            'rejected': rejected, 'artifact_unchanged': unchanged, 'verdict': verdict}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider', required=True, choices=['claude', 'codex'])
    parser.add_argument('--case', required=True, choices=['recovery', 'semantic', 'navigation', 'handoff'])
    parser.add_argument('--arm', required=True, choices=['old', 'new'])
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--old-ref', default='HEAD')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--recheck-loading', action='store_true', help='Reassess retained navigation path evidence without model calls')
    args = parser.parse_args()
    if args.case == 'handoff' and args.arm != 'new':
        parser.error('handoff checks the candidate loading path; use --arm new')
    out = args.out.resolve()
    if args.recheck_loading:
        meta = json.loads((out / 'meta.json').read_text())
        if args.case != 'navigation' or args.provider != 'codex' or any(meta[k] != getattr(args, k) for k in ['case', 'provider', 'arm']):
            parser.error('--recheck-loading requires the matching retained Codex navigation run')
        pkg = out / 'package'
        expected = pkg / 'plugins/orchestration/skills-codex/multi-model/SKILL.md'
        frozen = json.loads((out / 'snapshot.json').read_text())
        if frozen[str(expected.relative_to(pkg))] != hashlib.sha256(expected.read_bytes()).hexdigest():
            parser.error('Retained candidate differs from its frozen snapshot')
        result = json.loads((out / 'outcomes.json').read_text())
        paths = json.loads((out / 'loaded-candidate.json').read_text())['paths']
        result['checks']['candidate_loaded_normally'] = candidate_read_matches(paths, expected, out / 'repo')
        if args.arm == 'new':
            result['checks']['no_delegation_workflow_for_standalone_edit'] = not workflow_reads(out)
        optional = {'no_profile_announcements', 'no_reapproval', 'no_skill_reload_on_continuation'} if args.arm == 'old' else set()
        result['passed'] = all(value for key, value in result['checks'].items() if key not in optional)
        result['assessment'] = 'relative paths resolved against retained fixture; zero new model calls'
        dump(out / 'assessment-v2.json', result)
        print(json.dumps(result['checks'], ensure_ascii=False))
        return 0 if result['passed'] else 1
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        print('Refusing nonempty result directory', file=sys.stderr); return 73
    if out.is_relative_to(ROOT / 'plugins'):
        parser.error('--out must be outside plugin sources')
    cli = shutil.which(args.provider)
    if not cli:
        print('Native CLI unavailable', file=sys.stderr); return 69
    os.umask(0o077)
    out.mkdir(parents=True, exist_ok=True)
    pkg, marketplace, versions = snapshot(out, args.arm, args.old_ref)
    repo, base = fixture(out, args.case, args.provider)
    expected = {'case': args.case, 'first_outcome': 'environment-blocked' if args.case == 'recovery' else 'green tests, semantic rejection',
         'executor_calls_after_recovery': 1 if args.arm == 'new' else 2, 'candidate_head_must_remain': args.arm == 'new',
         'semantic_defect': 'negative-input guard removed; 39 tests cover only nonnegative inputs'}
    if args.case == 'navigation':
        expected = {'case': 'navigation', 'turns': 4, 'allowed_edit': '.github/workflows/ci.yml: timeout-minutes 10 to 15',
                    'other_files_unchanged': True, 'no_commit': True, 'normal_candidate_loading': True,
                    'no_reapproval_or_reload_after_first_skill_use': args.arm == 'new', 'no_children': True}
    elif args.case == 'handoff':
        expected = {'case': 'handoff', 'mandatory_workflow_loaded': True, 'executor_calls': 1, 'reviewer_calls': 1,
                    'native_wave_accepted': True, 'main_unchanged': True, 'signing_config_unchanged': True}
    dump(out / 'expected.json', expected)
    dump(out / 'meta.json', {'provider': args.provider, 'case': args.case, 'arm': args.arm, 'base': base,
         'versions': versions, 'marketplace': marketplace, 'source': 'working tree' if args.arm == 'new' else args.old_ref,
         'loading': 'workspace skills, plugins disabled' if args.provider == 'codex' and args.case == 'navigation' else 'disposable plugin directory / direct runner',
         'cli_version': call([cli, '--version'], timeout=15), 'started': time.time()})
    if args.prepare_only:
        return 0
    try:
        if args.case == 'recovery':
            result = recovery(out, repo, base, pkg, args.provider, args.arm, cli)
        elif args.case == 'navigation':
            result = navigation(out, repo, base, pkg, marketplace, versions, args.provider, cli)
        elif args.case == 'handoff':
            result = handoff(out, repo, base, pkg, args.provider, cli)
        else:
            result = semantic(out, repo, base, pkg, args.provider, cli)
    except Exception as e:
        result = {'passed': False, 'error': str(e)}
    dump(out / 'outcomes.json', result)
    print(json.dumps({k: v for k, v in result.items() if k != 'metrics'}, ensure_ascii=False))
    print('Evidence: '+str(out))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
