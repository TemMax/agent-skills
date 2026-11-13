#!/usr/bin/env python3
"""Live check of the premium rule in planning (ADR 020).

One headless super-plan run on a real host CLI and model, against
plan-content-live.py's `interfaces` repository, with the working tree's
plugins loaded disposably (Claude: `--plugin-dir`; Codex: workspace skills
with user plugins disabled). No installed plugin, marketplace or
configuration is touched. Expectations are frozen in expected.json before
the run; checks.json records the outcome.

Cases:
  asked   — the request ends with the user's own sentence asking for Fable 5.2
            supervision ("Надзор за каждой волной давай fable 5.2 medium.").
            Expected: a lint-clean plan whose every wave supervisor is
            `claude-fable-5-2`, an `approvals.premium` that lists it with
            approved_by "user", no executor or rung on a Fable model, and no
            `claude-fable-5-1` anywhere. The supervisor's effort is recorded.
  unasked — the same request without that sentence. Expected: a lint-clean
            plan with no premium model in any role (`claude-fable-5-2`,
            `claude-fable-5-1`, `gpt-6-astra`) and no `approvals.premium`.

On Claude the seat's own profile read is recorded (fable-seat-live.py's seat
checks) when the seat is a Fable 5.2 session.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil

from claude_session_events import read_events, final_result, usage

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


plan_live = load('plan_live', 'plan-content-live.py')
seat_live = load('seat_live', 'fable-seat-live.py')
bench = plan_live.bench
ASKED = 'Надзор за каждой волной давай fable 5.2 medium.'
PREMIUM = ('claude-fable-5-2', 'claude-fable-5-1', 'gpt-6-astra')
MARK = 'Fable 5.2 / GPT-6 Astra, any role'


def request(case):
    base = plan_live.REQUESTS['interfaces']
    return base + ('\n\n' + ASKED if case == 'asked' else '')


def prompt_for(case, provider, plan_rel):
    skill = 'orchestration:super-plan' if provider == 'claude' else '$super-plan'
    return (f'Use {skill} to plan the change below. EVAL MODE: no user can answer — apply the '
            f"skill's headless evaluation mode. Write the plan to {plan_rel} in this repository, "
            "run the skill's Lint step on it and fix every error. Do not implement anything and do "
            'not change any other file. When the plan is lint-clean, reply with its path only.\n\n'
            f'Change: {request(case)}\n')


def wave_plan(text):
    m = re.search(r'```json wave-plan\n(.*?)\n\s*```', text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def roles(plan):
    """(role, model) for every supervisor, executor and rung of the plan."""
    out = []
    for w in plan.get('waves') or []:
        out.append(('supervisor', (w.get('supervisor') or {}).get('model'), (w.get('supervisor') or {}).get('effort')))
        for t in w.get('tasks') or []:
            out.append(('executor', (t.get('executor') or {}).get('model'), (t.get('executor') or {}).get('effort')))
            out.extend(('rung', m, None) for m in t.get('ladder') or [])
    return out


def premium_checks(case, plan_text):
    plan = wave_plan(plan_text) or {}
    rs = roles(plan)
    premium = (plan.get('approvals') or {}).get('premium')
    facts = {'roles': rs, 'approvals_premium': premium}
    if case == 'asked':
        sups = [m for r, m, _ in rs if r == 'supervisor']
        checks = {
            'every_supervisor_is_claude_fable_5_2': bool(sups) and all(m == 'claude-fable-5-2' for m in sups),
            'approval_lists_claude_fable_5_2': isinstance(premium, dict)
                and 'claude-fable-5-2' in (premium.get('models') or []) and premium.get('approved_by') == 'user',
            'no_fable_executor_or_rung': not any(r != 'supervisor' and str(m).startswith('claude-fable') for r, m, _ in rs),
            'no_claude_fable_5_1': 'claude-fable-5-1' not in plan_text,
        }
        facts['supervisor_efforts'] = [e for r, _, e in rs if r == 'supervisor']
    else:
        checks = {'no_premium_model': not any(m in PREMIUM for _, m, _ in rs),
                  'no_premium_approval': premium is None}
    return checks, facts


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--provider', required=True, choices=['claude', 'codex'])
    p.add_argument('--case', required=True, choices=['asked', 'unasked'])
    p.add_argument('--model')
    p.add_argument('--effort', default='medium')
    p.add_argument('--budget-usd', type=float, default=8)
    p.add_argument('--timeout', type=int, default=1500)
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args(); out = args.out.resolve()
    if args.case == 'asked' and args.provider != 'claude':
        p.error('the asked case names a Claude model; Codex plans name GPT models only')
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT): p.error('Results must be outside the repository')
    model = args.model or ('claude-fable-5-2' if args.provider == 'claude' else 'gpt-6.1-sol')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, _, versions = bench.snapshot(out, 'new', 'HEAD')
    workflow = pkg / 'plugins/orchestration' / ('skills' if args.provider == 'claude' else 'skills-codex') / 'super-plan/WORKFLOW.md'
    if args.provider == 'claude' and MARK not in workflow.read_text():
        raise SystemExit(f'snapshot lacks the candidate marker: {MARK!r}')
    repo, base = plan_live.fixture(out, 'interfaces')
    plan_rel = 'docs/superpowers/plans/2026-11-13-live.md'
    expected = {'case': args.case, 'provider': args.provider, 'model': model, 'effort': args.effort,
                'run_complete': True, 'plan_written': True, 'lint_ok': True,
                'workflow_loaded_from_snapshot': True, 'no_other_product_file_changed': True}
    if args.case == 'asked':
        expected.update(every_supervisor_is_claude_fable_5_2=True, approval_lists_claude_fable_5_2=True,
                        no_fable_executor_or_rung=True, no_claude_fable_5_1=True,
                        recorded='the supervisor effort the plan chose')
    else:
        expected.update(no_premium_model=True, no_premium_approval=True)
    if args.provider == 'claude' and model == 'claude-fable-5-2':
        expected.update(profile_read='orchestrator-fable-5-2.md', no_other_profile_read=True,
                        no_spawn_without_model=True)
    bench.dump(out / 'expected.json', expected)
    before = {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts}
    cmd = plan_live.command(args.provider, repo, out, pkg, model, args.effort, args.budget_usd)
    bench.dump(out / 'meta.json', {'provider': args.provider, 'case': args.case, 'model': model,
        'effort': args.effort, 'versions': versions, 'base': base, 'workflow': str(workflow),
        'loading': 'disposable --plugin-dir' if args.provider == 'claude' else 'workspace skills, user config and plugins disabled',
        'cli_version': bench.call([shutil.which(args.provider), '--version'])})
    print(f'{args.provider}/{args.case}: planning with {model}/{args.effort}', flush=True)
    rc = bench.run_logged(cmd, out, 'run', cwd=repo, prompt=prompt_for(args.case, args.provider, plan_rel),
                          timeout=args.timeout)
    trace = (out / 'run.stdout').read_text(errors='replace')
    rows = read_events(out / 'run.stdout')
    if args.provider == 'claude':
        res = final_result(rows)
        spend = {'usd': res.get('total_cost_usd'), 'usage': usage(rows), 'turns': res.get('num_turns'),
                 'models_billed': sorted((res.get('modelUsage') or {}).keys())}
        complete = res.get('subtype') == 'success' and not res.get('is_error')
    else:
        done = [r for r in rows if r.get('type') == 'turn.completed']
        spend = {'usage': done[-1].get('usage') if done else None}
        complete = bool(done)
    plan = repo / plan_rel
    plan_text = plan.read_text() if plan.exists() else ''
    lint_out = ''
    if plan.exists():
        shutil.copyfile(plan, out / 'plan.md')
        lint = bench.subprocess.run(['node', str(pkg / plan_live.LINT), str(plan), '--repo', str(repo)],
                                    capture_output=True, text=True)
        lint_out = lint.stdout + lint.stderr
    (out / 'lint.txt').write_text(lint_out)
    after = {str(f.relative_to(repo)): hashlib.sha256(f.read_bytes()).hexdigest()
             for f in repo.rglob('*') if f.is_file() and '.git' not in f.parts and '.agents' not in f.parts}
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k != plan_rel
                     and not k.startswith('.agents/') and '__pycache__' not in k)
    checks = {'run_complete': rc == 0 and complete, 'plan_written': bool(plan_text),
              'lint_ok': bool(re.search(r'(?m)^OK: 0 error', lint_out)),
              'workflow_loaded_from_snapshot': 'super-plan/WORKFLOW.md' in trace and str(pkg) in trace,
              'no_other_product_file_changed': not changed}
    pchecks, facts = premium_checks(args.case, plan_text)
    checks.update(pchecks)
    if args.provider == 'claude' and model == 'claude-fable-5-2':
        seat, seat_facts = seat_live.seat_checks(rows, 'orchestrator-fable-5-2.md')
        for k in ('profile_read', 'no_other_profile_read', 'no_spawn_without_model'):
            checks[k] = seat[k]
        facts.update(seat_facts)
    seconds = json.loads((out / 'run.status.json').read_text())['seconds']
    bench.dump(out / 'metrics.json', {**facts, 'changed_files': changed, 'seconds': round(seconds), 'spend': spend,
                                      'lint_warnings': re.findall(r'(?m)^warn: (\S+):', lint_out)})
    bench.dump(out / 'checks.json', checks)
    print(json.dumps({'checks': checks, 'facts': facts, 'seconds': round(seconds), 'spend': spend},
                     ensure_ascii=False, indent=1, default=str))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
