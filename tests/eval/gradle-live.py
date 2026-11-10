#!/usr/bin/env python3
"""Live wave on a Gradle project: a checkout builds its own sources.

One real wave through a runner (`claude-wave-runner.mjs` or
`codex-wave-runner.mjs`) and the real host CLI, on a fresh disposable Gradle
project with the configuration cache on. Before the wave, the repository
checkout runs the task's own check, `./gradlew --offline checkGreeting`:
it fails on the old `greet` and stores a configuration cache entry that
names the repository checkout. The task changes `greet`; the check passes
only when the checkout that runs it builds its own sources. A checkout that
reuses the repository checkout's entry builds the old `greet` and fails.

`--arm new` loads the candidate (this working tree); `--arm old --ref R`
loads `git archive R`, the control. `--mode executor` sets
`worktree.share_builds: "executor"`. Expectations are frozen in
expected.json before the run. Needs the Gradle 8.14.2 distribution in
`~/.gradle/wrapper/dists` and a JDK on PATH; builds run `--offline`.
"""
import argparse
import glob
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cost_live', Path(__file__).with_name('cost-control-live.py'))
bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)

GRADLE_VERSION = '8.14.2'
CHECK = './gradlew --offline checkGreeting'
OLD_GREETER = '''package greet;

public final class Greeter {
    public static String greet(String name) {
        return "Hello, " + name;
    }
}
'''
FILES = {
    '.gitignore': '.gradle/\nbuild/\n.worktrees/\n',
    'settings.gradle': "rootProject.name = 'greet'\n",
    'gradle.properties': 'org.gradle.configuration-cache=true\n',
    'build.gradle': '''plugins { id 'java' }

tasks.register('checkGreeting', JavaExec) {
    classpath = sourceSets.main.runtimeClasspath
    mainClass = 'greet.Check'
}
''',
    'src/main/java/greet/Greeter.java': OLD_GREETER,
    'src/main/java/greet/Check.java': '''package greet;

public final class Check {
    public static void main(String[] args) {
        String got = Greeter.greet("Ann");
        if (!"Hello, Ann!".equals(got)) {
            System.err.println("checkGreeting: expected Hello, Ann! but got " + got);
            System.exit(1);
        }
        System.out.println("checkGreeting: ok, " + got);
    }
}
''',
    'AGENTS.md': f'Check the project with `{CHECK}`. Do not create a PR.\n',
}


def gradle_dist():
    found = glob.glob(str(Path.home() / f'.gradle/wrapper/dists/gradle-{GRADLE_VERSION}-bin/*/gradle-{GRADLE_VERSION}/bin/gradle'))
    if not found: raise SystemExit(f'blocked: Gradle {GRADLE_VERSION} distribution is not in ~/.gradle/wrapper/dists')
    return found[0]


def digest(path):
    h = hashlib.sha256()
    if not path.exists(): return None
    for p in sorted(path.rglob('*')):
        rel = str(p.relative_to(path))
        if p.is_symlink(): h.update(f'L {rel} {os.readlink(p)}\n'.encode())
        elif p.is_file(): h.update(f'F {rel} {hashlib.sha256(p.read_bytes()).hexdigest()}\n'.encode())
    return h.hexdigest()


def gradlew(cwd, out, name):
    r = subprocess.run(CHECK.split(), cwd=cwd, capture_output=True, text=True, timeout=600)
    (out / (name + '.log')).write_text(f'exit {r.returncode}\n--- stdout\n{r.stdout}\n--- stderr\n{r.stderr}')
    return r


def fixture(out, provider, mode):
    repo = out / 'repo'
    for rel, text in FILES.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True); (repo / rel).write_text(text)
    bench.call([gradle_dist(), '--offline', '--no-configuration-cache', 'wrapper', '--gradle-version', GRADLE_VERSION],
               cwd=repo, timeout=300)
    bench.git(repo, 'init', '-b', 'main')
    for k, v in [('user.name', 'Live fixture'), ('user.email', 'fixture@example.invalid'),
                 ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
        bench.git(repo, 'config', k, v)
    bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-m', 'Frozen fixture')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    # The repository checkout's own run of the check: fails on the old greet
    # and stores the configuration cache entry a cloned .gradle would carry.
    pre = gradlew(repo, out, 'repository-prebuild')
    if pre.returncode == 0 or 'Configuration cache entry stored' not in pre.stdout + pre.stderr:
        raise SystemExit('fixture: the repository prebuild must fail and store a configuration cache entry; see repository-prebuild.log')
    (repo / '.gradle/repository-marker').write_text('cloned from the repository checkout\n')
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', str(origin)], timeout=30)
    bench.git(repo, 'remote', 'add', 'origin', str(origin)); bench.git(repo, 'push', '-u', 'origin', 'main')
    executor = 'claude-haiku-5-5' if provider == 'claude' else 'gpt-6-luna'
    supervisor = 'claude-sonnet-5-5' if provider == 'claude' else 'gpt-6.1-sol'
    plan = {'waves': [{'wave': 1, 'limits': {'max_attempts': 1, 'max_model_calls': 2},
        'supervisor': {'model': supervisor, 'effort': 'medium'},
        'tasks': [{'id': 'one', 'branch': 'wave/one', 'executor': {'model': executor, 'effort': 'medium'},
            'ladder': [], 'contract': {'files_allowed': ['src/main/java/greet/Greeter.java'],
            'files_forbidden': ['src/main/java/greet/Check.java', 'build.gradle', 'settings.gradle',
                                'gradle.properties', 'gradle/**', 'gradlew', 'gradlew.bat', 'AGENTS.md'],
            'must_run': [{'cmd': CHECK, 'evidence': 'required'}],
            'forbidden_moves': ['Do not change the check, the build scripts or the Gradle settings'],
            'report_must_answer': ['What does Greeter.greet("Ann") return now?']}}]}],
        'ci': 'none: disposable fixture has no CI', 'e2e': 'not-applicable: no user interface'}
    if mode == 'executor': plan['worktree'] = {'share_builds': 'executor'}
    (out / 'plan.md').write_text('status: draft\nbase: pending\n\n```json wave-plan\n' + json.dumps(plan, indent=2)
        + '\n```\n\n## Task one\n\nIn src/main/java/greet/Greeter.java, `greet(name)` must return `Hello, <name>!` — '
        'with a trailing exclamation mark. Change nothing else.\n')
    return repo, base


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', required=True, choices=['claude', 'codex'])
    p.add_argument('--mode', default='repository', choices=['repository', 'executor'])
    p.add_argument('--arm', default='new', choices=['new', 'old'])
    p.add_argument('--ref', default='main', help='git ref loaded by --arm old')
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args(); out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, args.arm, args.ref)
    repo, base = fixture(out, args.provider, args.mode)
    refs = pkg / 'plugins/orchestration/skills/multi-model/references'
    if args.arm == 'new':
        expected = {'wave_exit': True, 'task_accepted': True, 'executor_gradle_cloned': True,
                    'worktree_check_passes': True, 'repository_cache_unchanged': True,
                    'repository_build_unchanged': True, 'repository_source_unchanged': True}
    else:  # the control: the reused entry builds the old greet, so the task cannot pass
        expected = {'task_accepted': False}
    bench.dump(out / 'expected.json', expected)
    before = {'cache': digest(repo / '.gradle/configuration-cache'), 'build': digest(repo / 'build')}
    cli = shutil.which(args.provider)
    transport = bench.adapter(out, cli, args.provider, pkg, max_calls=4, inject_fault=False)
    cmd = ['node', str(refs / (args.provider + '-wave-runner.mjs')), '--plan', str(out / 'plan.md'), '--wave', '1',
           '--repo', str(repo), '--base', base, '--' + args.provider, str(transport),
           '--jobs', '1', '--timeout-min', '10', '--preflight', 'off', '--out', str(out / 'wave')]
    if args.provider == 'claude': cmd += ['--default-branch', 'main']
    bench.dump(out / 'meta.json', {'provider': args.provider, 'mode': args.mode, 'arm': args.arm,
                                   'ref': args.ref if args.arm == 'old' else 'working tree', 'versions': versions,
                                   'base': base, 'cli_version': bench.call([cli, '--version'])})
    print(f'{args.provider}/{args.mode}/{args.arm}: running the wave', flush=True)
    rc = bench.run_logged(cmd, out, 'wave-run', timeout=1800)
    summary_path = out / 'wave/summary.json'
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    tasks = summary.get('tasks') or []
    worktrees = [w for w in (repo / '.worktrees').glob('*') if (w / 'gradlew').exists()] if (repo / '.worktrees').exists() else []
    reruns = [gradlew(w, out, 'worktree-rerun-' + w.name) for w in worktrees]
    checks = {
        'wave_exit': rc == 0,
        'task_accepted': bool(tasks) and all(t.get('status') == 'ok' for t in tasks),
        'executor_gradle_cloned': bool(worktrees) and all(
            (w / '.gradle').is_dir() and not (w / '.gradle').is_symlink() and (w / '.gradle/repository-marker').exists()
            for w in worktrees),
        'worktree_check_passes': bool(reruns) and all(r.returncode == 0 for r in reruns),
        'repository_cache_unchanged': digest(repo / '.gradle/configuration-cache') == before['cache'],
        'repository_build_unchanged': digest(repo / 'build') == before['build'],
        'repository_source_unchanged': (repo / 'src/main/java/greet/Greeter.java').read_text() == OLD_GREETER,
    }
    # Informational: what the wave's own logs say about the configuration cache.
    text = ''
    for f in list((out / 'wave').rglob('*')) if (out / 'wave').exists() else []:
        if f.is_file() and f.stat().st_size < 20_000_000:
            try: text += f.read_text(errors='replace')
            except OSError: pass
    calls = [json.loads(l) for l in (out / 'calls.jsonl').read_text().splitlines()] if (out / 'calls.jsonl').exists() else []
    bench.dump(out / 'checks.json', checks)
    verdict = {k: checks.get(k) == v for k, v in expected.items()}
    bench.dump(out / 'verdict.json', verdict)
    print(json.dumps({'checks': checks, 'verdict_vs_expected': verdict, 'worktrees': [str(w) for w in worktrees],
                      'log_mentions': {'reusing': text.count('Reusing configuration cache'),
                                       'stored': text.count('Configuration cache entry stored'),
                                       'expected_got_old': text.count('but got Hello, Ann')},
                      'model_calls': len(calls),
                      'seconds': json.loads((out / 'wave-run.status.json').read_text()).get('seconds')}, indent=1))
    return 0 if all(verdict.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
