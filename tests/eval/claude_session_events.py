"""Claude stream parsing. Deduplicate message usage; keep child traces separate."""
import importlib.util
import json
from pathlib import Path
import shlex


def read_events(path):
    rows = []
    for line in Path(path).read_text(errors='replace').splitlines():
        try:
            row = json.loads(line)
            if isinstance(row, dict):
                rows.append(row)
        except ValueError:
            pass
    return rows


def usage(rows):
    messages = {}
    for i, row in enumerate(rows):
        if row.get('type') != 'assistant' or row.get('parent_tool_use_id'):
            continue
        msg = row.get('message') or {}
        # Missing IDs cannot be safely deduplicated; retain each record.
        key = msg.get('id') or f'missing-{i}'
        values = messages.setdefault(key, {})
        for field, value in (msg.get('usage') or {}).items():
            if isinstance(value, (float, int)):
                values[field] = max(values.get(field, 0), value)
    sums = {field: sum(v.get(field, 0) for v in messages.values()) for field in
            ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')}
    # Native streaming assistant events can expose only initial output counts.
    # A final CLI result has completed output usage. Use it only when all root
    # input buckets match the deduplicated messages, so child/cumulative totals
    # cannot silently replace a different token scope. Transcript-only traces
    # and incomplete/mismatched result envelopes retain message evidence.
    fields = tuple(sums)
    results = [r.get('usage') or {} for r in rows if r.get('type') == 'result' and not r.get('parent_tool_use_id')]
    if results and all(all(isinstance(u.get(k), (int, float)) and u[k] >= 0 for k in fields) for u in results):
        totals = {k: sum(u[k] for u in results) for k in fields}
        if all(totals[k] == sums[k] for k in fields if k != 'output_tokens'):
            sums['output_tokens'] = max(sums['output_tokens'], totals['output_tokens'])
    return {**sums, 'requests': len(messages), 'total': sum(sums.values())}


def final_result(rows):
    return next((r for r in reversed(rows) if r.get('type') == 'result'), {})


def skill_loads(rows):
    """The host injects the body as a user text block after a Skill tool call."""
    loads = []
    for row in rows:
        if row.get('type') != 'user' or row.get('parent_tool_use_id'):
            continue
        content = (row.get('message') or {}).get('content') or []
        if isinstance(content, str):
            content = [{'type': 'text', 'text': content}]
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text' and block.get('text', '').startswith('Base directory for this skill: '):
                loads.append(block['text'].split('\n', 1)[0].removeprefix('Base directory for this skill: '))
    return loads


def normalize(path):
    """Adapt root text/tools to the existing behavioral classifier, not its token parser."""
    rows = read_events(path)
    results, blocks = {}, {}
    for row in rows:
        if row.get('parent_tool_use_id'):
            continue
        content = (row.get('message') or {}).get('content') or []
        if not isinstance(content, list):
            continue
        for i, block in enumerate(content):
            if block.get('type') == 'tool_result':
                results[block.get('tool_use_id')] = not block.get('is_error', False)
            elif row.get('type') == 'assistant' and block.get('type') in ('tool_use', 'text'):
                mid = (row.get('message') or {}).get('id') or str(id(row))
                key = block.get('id') or f'{mid}:{i}'
                blocks[key] = block
    events = []
    for key, block in blocks.items():
        kind = block['type']
        name, args = block.get('name'), block.get('input') or {}
        # Attempted tools count as attempts, but failed edits must never count as successful writes.
        status = 'completed' if results.get(key) else 'failed'
        item = {'id': key, 'status': status}
        if kind == 'text':
            item.update(type='agent_message', text=block.get('text', ''))
        elif name == 'Bash':
            item.update(type='command_execution', command=args.get('command', ''))
        elif name == 'Read':
            target = shlex.quote(args.get('file_path', ''))
            command = 'cat ' + target
            if 'offset' in args or 'limit' in args:
                start = int(args.get('offset', 1))
                end = start + int(args.get('limit', 999999)) - 1
                command = f"sed -n '{start},{end}p' {target}"
            item.update(type='command_execution', command=command)
        elif name in ('Edit', 'Write') and status == 'completed':
            item.update(type='file_change', changes=[{'path': args.get('file_path', ''), 'kind': 'update'}])
        elif name in ('Agent', 'Task') and status == 'completed':
            item.update(type='collab_tool_call', tool='spawn_agent', prompt=args.get('prompt', ''))
        else:
            item.update(type='claude_tool_call', tool=name)
        events.append({'type': 'item.completed', 'item': item})
    u = usage(rows)
    result = final_result(rows)
    measured = {
        'input_tokens': u['input_tokens'] + u['cache_creation_input_tokens'] + u['cache_read_input_tokens'],
        'cached_input_tokens': u['cache_read_input_tokens'],
        'cache_write_input_tokens': u['cache_creation_input_tokens'],
        'output_tokens': u['output_tokens']}
    if result.get('subtype') == 'success' and not result.get('is_error'):
        events.append({'type': 'turn.completed', 'usage': measured})
    else:
        events.append({'type': 'turn.failed', 'error': result.get('subtype', 'missing result'), 'usage': measured})
    return events


def analyze(run):
    path = Path(__file__).with_name('skill-session-ab-analyze.py')
    spec = importlib.util.spec_from_file_location('session_behavior', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    report = module.analyze_run(str(run), event_loader=normalize, provider='claude')
    streams = [read_events(p) for p in sorted(Path(run).glob('turn-*.jsonl'))]
    # Count per turn, so a deliberately repeated ID in a synthetic trace is also isolated.
    per_turn = [usage(rows) for rows in streams]
    root_usage = {k: sum(u[k] for u in per_turn) for k in usage([])}
    children = list((Path(run) / 'child-rollouts').rglob('agent-*.jsonl'))
    child_usage = [usage(read_events(p)) for p in children]
    child_tokens = sum(u['total'] for u in child_usage) if children else None
    # Native child usage is known only when its transcript was captured; shell-launched CLI children
    # are outside this collector and must not silently be priced as zero.
    summary = report['summary']
    meta_path = Path(run) / 'meta.json'
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    costs = [final_result(rows).get('total_cost_usd') for rows in streams]
    known_costs = [c for c in costs if isinstance(c, (int, float)) and c >= 0]
    summary.update(provider='claude', scenario=meta.get('scenario'), root_usage=root_usage,
                   host_skill_loads=sum(len(skill_loads(rows)) for rows in streams),
                   captured_child_tokens=child_tokens,
                   captured_tokens=root_usage['total']+(child_tokens or 0),
                   total_tree_tokens=None, child_transcripts=len(children),
                   known_reported_cost_usd=sum(known_costs),
                   reported_cost_usd=sum(known_costs) if len(known_costs) == len(costs) else None)
    status_path = Path(run) / 'run-status.json'
    summary['run_status'] = json.loads(status_path.read_text()) if status_path.exists() else None
    for turn, rows in zip(report['per_turn'], streams):
        turn['host_skill_loads'] = len(skill_loads(rows))
    outcomes = Path(run) / 'outcomes.json'
    summary['outcomes'] = json.loads(outcomes.read_text()) if outcomes.exists() else None
    Path(run, 'metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    return report
