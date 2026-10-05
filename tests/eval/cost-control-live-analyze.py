#!/usr/bin/env python3
"""Account for owned real-run artifacts, including failures. Never launch a model.

Recovery summaries carry prior calls, so deduplicate by owned result path or
Codex thread ID rather than summing summaries. Claude Workflow coordinator and
children are separate token scopes; reported dollar costs are not added across
those scopes because the CLI's cost inclusion semantics are not established.
"""
import argparse
import json
import importlib.util
from pathlib import Path
from claude_session_events import read_events, usage


FIELDS = ('uncached_input', 'cache_creation', 'cache_read', 'output')


def normalized(raw, provider):
    if not raw or 'input_tokens' not in raw or 'output_tokens' not in raw:
        return None
    if provider == 'claude':
        return {'uncached_input': raw['input_tokens'], 'cache_creation': raw.get('cache_creation_input_tokens'),
                'cache_read': raw.get('cache_read_input_tokens'), 'output': raw['output_tokens']}
    cached = raw.get('cached_input_tokens')
    return {'uncached_input': raw['input_tokens']-cached if cached is not None else None,
            # Codex input is already inclusive of cached input. Cache creation is
            # not reported separately; do not invent another additive bucket.
            'cache_creation': None, 'cache_read': cached, 'output': raw['output_tokens'],
            'inclusive_input': raw['input_tokens']}


def aggregate(entries, provider):
    records = [e['usage'] for e in entries if e.get('usage') is not None]
    totals = {k: sum(r[k] for r in records) if records and all(r.get(k) is not None for r in records) else None
              for k in FIELDS}
    inputs = [r.get('inclusive_input') if provider == 'codex' else
              sum(r[k] for k in FIELDS[:3]) if all(r.get(k) is not None for k in FIELDS[:3]) else None
              for r in records]
    total_input = sum(inputs) if inputs and all(x is not None for x in inputs) else None
    return {**totals, 'inclusive_input': total_input,
            'total_tokens': total_input+totals['output'] if total_input is not None and totals['output'] is not None else None,
            'captured_invocations': sum(e.get('invocation_count', 1) for e in entries),
            'usage_complete': len(records) == len(entries) and bool(entries)}


def analyze(root):
    root = Path(root).resolve()
    meta = json.loads((root / 'meta.json').read_text())
    outcome = json.loads((root / 'outcomes.json').read_text()) if (root / 'outcomes.json').exists() else {}
    provider, case = meta['provider'], meta['case']
    entries, coordinator, seen = [], [], set()
    if provider == 'codex' and case != 'navigation':
        files = sorted(root.glob('*/one/*.events.jsonl'))
        if case == 'semantic': files = [root / 'judge.stdout']
        for path in files:
            rows = read_events(path)
            sid = next((r['thread_id'] for r in rows if r.get('type') == 'thread.started'), None)
            if not sid or sid in seen: continue
            seen.add(sid)
            turns = [r.get('usage') for r in rows if r.get('type') == 'turn.completed']
            raw = {k: sum(t[k] for t in turns) for k in ('input_tokens', 'cached_input_tokens', 'output_tokens')
                   if turns and all(k in t for t in turns)}
            entries.append({'role': 'executor' if 'executor' in path.name else 'supervisor',
                            'id': sid, 'artifact': str(path), 'usage': normalized(raw, provider)})
    elif provider == 'claude' and case == 'recovery':
        children = root / 'workflow-children.json'
        if children.exists():
            for c in json.loads(children.read_text()):
                path = Path(c['path'])
                entries.append({'role': c['role'], 'artifact': str(path), 'usage': normalized(usage(read_events(path)), provider)})
            coordinator.append({'role': 'coordinator', 'artifact': str(root / 'rollout.jsonl'),
                                'invocation_count': len(list(root.glob('workflow-*.status.json'))),
                                'usage': normalized(usage(read_events(root / 'rollout.jsonl')), provider)})
        else:
            for summary in root.glob('*/summary.json'):
                for c in json.loads(summary.read_text()).get('children', []):
                    path = c.get('result')
                    if not path or path in seen: continue
                    seen.add(path)
                    entries.append({'role': c['role'], 'artifact': path, 'usage': normalized(c.get('usage'), provider)})
            # Preserve paid failed Workflow launch attempts even with no children.
            rows = [r for p in root.glob('workflow-*.stdout') for r in read_events(p)]
            if rows:
                coordinator.append({'role': 'coordinator', 'usage': normalized(usage(rows), provider)})
    elif case == 'semantic':
        envelope = json.loads((root / 'judge.stdout').read_text())
        entries.append({'role': 'supervisor', 'artifact': str(root / 'judge.stdout'), 'usage': normalized(envelope.get('usage'), provider)})
    else:
        per_turn = {}
        if provider == 'codex':
            spec = importlib.util.spec_from_file_location('codex_accounting', Path(__file__).with_name('skill-session-ab-analyze.py'))
            module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
            metrics = module.analyze_run(str(root))
            per_turn = {t['turn']: t for t in metrics['per_turn']}
        for path in sorted(root.glob('turn-*.jsonl')):
            rows = read_events(path)
            if provider == 'claude': raw = usage(rows)
            else: raw = per_turn[int(path.stem.split('-')[1])]
            entries.append({'role': 'coordinator', 'artifact': str(path), 'usage': normalized(raw, provider)})
    pipeline = aggregate(entries, provider)
    coordination = aggregate(coordinator, provider) if coordinator else None
    whole_entries = entries+coordinator
    return {'run': str(root), 'provider': provider, 'case': case, 'arm': meta['arm'],
            'versions': meta['versions'], 'passed': outcome.get('passed', False),
            'pipeline': pipeline, 'additional_workflow_coordinator': coordination,
            'whole_captured_task': aggregate(whole_entries, provider), 'invocations': whole_entries,
            'quality_checks': outcome.get('checks'),
            'limits': 'One repetition per arm; captured scopes only. Invocation counts are not API request counts. '
                      'Old recovery explicitly uses full-wave rerun; optimal old resume is not measured. '
                      'Semantic probe compares prompts over the same independent verifier facts, not old pipeline cost.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runs', nargs='+', type=Path)
    args = parser.parse_args()
    for path in args.runs:
        result = analyze(path)
        (path / 'cost-accounting.json').write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps({k: result[k] for k in ('run', 'provider', 'case', 'arm', 'passed', 'pipeline',
                                                'additional_workflow_coordinator', 'whole_captured_task')}))


if __name__ == '__main__': main()
