#!/usr/bin/env python3
"""Live wave on a pnpm workspace: each checkout's build is cloned with clonefile(2).

One real wave through the candidate's own runner (`claude-wave-runner.mjs` or
`codex-wave-runner.mjs`) and the real host CLI, on a fresh disposable pnpm
workspace with a Cargo-style `target` beside it: `apps/cli` depends on the
workspace package `@ws/core` and on a `file:` package that pnpm stores under
`node_modules/.pnpm`. Every link in the repository checkout's build
directories gets an old time; a directory cloned with clonefile(2) calls
keeps it, `cp -cR` would not. The task changes `@ws/core`; the fixture's test
in `apps/cli` passes only when the checkout that runs it resolves `@ws/core`
to its own code. Expectations are frozen in expected.json before the run.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cost_live', Path(__file__).with_name('cost-control-live.py'))
bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)

TEST = '''import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("the workspace package is this checkout's", () => {
  assert.equal(require("@ws/core").greet("Ann"), "Hello, Ann!");
});
test("the stored package resolves", () => {
  assert.equal(require("pad")("7", 3), "  7");
});
'''


def fixture(out, provider):
    repo = out / 'repo'
    files = {
        '.gitignore': 'node_modules/\n.worktrees/\ntarget/\n',
        'package.json': json.dumps({'name': 'ws', 'private': True}) + '\n',
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - apps/*\n',
        'vendor/pad/package.json': json.dumps({'name': 'pad', 'version': '1.0.0', 'main': 'index.js'}) + '\n',
        'vendor/pad/index.js': 'module.exports = (s, n) => String(s).padStart(n)\n',
        'packages/core/package.json': json.dumps({'name': '@ws/core', 'version': '1.0.0', 'main': 'index.js'}) + '\n',
        'packages/core/index.js': 'exports.greet = (name) => `Hello, ${name}`\n',
        'apps/cli/package.json': json.dumps({'name': 'cli', 'version': '1.0.0', 'private': True,
            'dependencies': {'@ws/core': 'workspace:*', 'pad': 'file:../../vendor/pad'}}) + '\n',
        'apps/cli/test.mjs': TEST,
        'AGENTS.md': 'Run tests with `node --test apps/cli/test.mjs`. Do not create a PR.\n',
    }
    for rel, text in files.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True); (repo / rel).write_text(text)
    bench.call(['pnpm', 'install', '--offline', '--config.confirmModulesPurge=false'], cwd=repo, timeout=300)
    (repo / 'target/debug').mkdir(parents=True)
    (repo / 'target/debug/dep.rlib').write_text('dep\n')
    (repo / 'target/debug/latest').symlink_to('dep.rlib')
    for build in BUILD_DIRS:
        for link in links(repo / build):
            os.utime(link, (OLD, OLD), follow_symlinks=False)
    bench.git(repo, 'init', '-b', 'main')
    for k, v in [('user.name', 'Live fixture'), ('user.email', 'fixture@example.invalid'),
                 ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
        bench.git(repo, 'config', k, v)
    bench.git(repo, 'add', '.'); bench.git(repo, 'commit', '-m', 'Frozen fixture')
    base = bench.git(repo, 'rev-parse', 'HEAD')
    origin = out / 'origin.git'
    bench.call(['git', 'init', '--bare', str(origin)], timeout=30)
    bench.git(repo, 'remote', 'add', 'origin', str(origin)); bench.git(repo, 'push', '-u', 'origin', 'main')
    executor = 'claude-haiku-5-5' if provider == 'claude' else 'gpt-6-luna'
    supervisor = 'claude-sonnet-5-5' if provider == 'claude' else 'gpt-6.1-sol'
    plan = {'waves': [{'wave': 1, 'limits': {'max_attempts': 1, 'max_model_calls': 2},
        'supervisor': {'model': supervisor, 'effort': 'medium'},
        'tasks': [{'id': 'one', 'branch': 'wave/one', 'executor': {'model': executor, 'effort': 'medium'},
            'ladder': [], 'contract': {'files_allowed': ['packages/core/index.js'],
            'files_forbidden': ['apps/**', 'AGENTS.md', 'pnpm-lock.yaml'],
            'must_run': [{'cmd': 'node --test apps/cli/test.mjs', 'evidence': 'required'}],
            'forbidden_moves': ['Do not change the tests or any package manifest'],
            'report_must_answer': ['What does greet("Ann") return now?']}}]}],
        'ci': 'none: disposable fixture has no CI', 'e2e': 'not-applicable: no user interface'}
    (out / 'plan.md').write_text('status: draft\nbase: pending\n\n```json wave-plan\n' + json.dumps(plan, indent=2)
        + '\n```\n\n## Task one\n\nIn packages/core/index.js, `greet(name)` must return `Hello, <name>!` — '
        'with a trailing exclamation mark. Change nothing else.\n')
    return repo, base


BUILD_DIRS = ['node_modules', 'apps/cli/node_modules', 'target']
OLD = 978307200  # 2001-01-01


def links(path):
    return [p for p in path.rglob('*') if p.is_symlink()]


def tree_digest(path):
    """Every entry under a node_modules: links by target, files by content."""
    h = hashlib.sha256()
    for p in sorted(path.rglob('*')):
        rel = str(p.relative_to(path))
        if p.is_symlink(): h.update(f'L {rel} {os.readlink(p)}\n'.encode())
        elif p.is_file(): h.update(f'F {rel} {hashlib.sha256(p.read_bytes()).hexdigest()}\n'.encode())
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', required=True, choices=['claude', 'codex'])
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args(); out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, 'new', 'HEAD')
    repo, base = fixture(out, args.provider)
    refs = pkg / 'plugins/orchestration/skills/multi-model/references'
    expected = {'wave_exit': 0, 'task_accepted': True, 'executor_build_cloned_by_clonefile': True,
                'workspace_link_resolves_to_worktree': True, 'repository_build_unchanged': True,
                'repository_core_unchanged': True}
    bench.dump(out / 'expected.json', expected)
    before = {build: tree_digest(repo / build) for build in BUILD_DIRS}
    cli = shutil.which(args.provider)
    transport = bench.adapter(out, cli, args.provider, pkg, max_calls=4, inject_fault=False)
    cmd = ['node', str(refs / (args.provider + '-wave-runner.mjs')), '--plan', str(out / 'plan.md'), '--wave', '1',
           '--repo', str(repo), '--base', base, '--' + args.provider, str(transport),
           '--jobs', '1', '--timeout-min', '8', '--preflight', 'off', '--out', str(out / 'wave')]
    if args.provider == 'claude': cmd += ['--default-branch', 'main']
    bench.dump(out / 'meta.json', {'provider': args.provider, 'versions': versions, 'base': base,
                                   'cli_version': bench.call([cli, '--version'])})
    print(f'{args.provider}: running the wave', flush=True)
    rc = bench.run_logged(cmd, out, 'wave-run', timeout=1500)
    summary_path = out / 'wave/summary.json'
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    worktrees = [w for w in (repo / '.worktrees').glob('*') if (w / 'node_modules').exists()] if (repo / '.worktrees').exists() else []
    core_links = [(w, w / 'apps/cli/node_modules/@ws/core') for w in worktrees]
    tasks = summary.get('tasks') or []
    checks = {
        'wave_exit': rc == 0,
        'task_accepted': bool(tasks) and all(t.get('status') == 'ok' for t in tasks),
        'executor_build_cloned_by_clonefile': bool(worktrees) and all(
            (w / build).is_dir() and not (w / build).is_symlink() and links(w / build)
            and all(l.lstat().st_mtime == OLD for l in links(w / build)) for w in worktrees for build in BUILD_DIRS),
        'workspace_link_resolves_to_worktree': bool(core_links) and all(
            link.resolve() == (w / 'packages/core').resolve() for w, link in core_links),
        'repository_build_unchanged': {build: tree_digest(repo / build) for build in BUILD_DIRS} == before,
        'repository_core_unchanged': (repo / 'packages/core/index.js').read_text() == 'exports.greet = (name) => `Hello, ${name}`\n',
    }
    calls = [json.loads(l) for l in (out / 'calls.jsonl').read_text().splitlines()] if (out / 'calls.jsonl').exists() else []
    bench.dump(out / 'checks.json', checks)
    print(json.dumps({'checks': checks, 'worktrees': [str(w) for w in worktrees], 'model_calls': len(calls),
                      'seconds': json.loads((out / 'wave-run.status.json').read_text()).get('seconds')}, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
