#!/usr/bin/env python3
"""Offline comparison of captured Claude session arms. Never calls a model."""
from collections import defaultdict
import json
from pathlib import Path
import sys
from claude_session_events import analyze


def main(paths):
    if not paths:
        print('Usage: python3 claude-skill-session-ab-analyze.py RUN_DIR [RUN_DIR ...]', file=sys.stderr)
        return 2
    reports = [analyze(p)['summary'] for p in paths]
    meta = [json.loads(Path(p, 'meta.json').read_text()) for p in paths]
    settings = {(m.get('scenario'), m.get('model'), m.get('effort'), m.get('requested_turns')) for m in meta}
    if len(settings) > 1:
        print('Cannot compare different scenarios, models, efforts or requested turn counts.', file=sys.stderr)
        return 2
    print('arm\tturns\tcompleted\treads\thost loads\tannouncements\tspawns\tinput\tcache read\tcache write\toutput\toutcome')
    for s in reports:
        print('\t'.join(str(s[k]) for k in ('arm', 'turns', 'turns_completed', 'skill_reads_full', 'host_skill_loads',
              'announce', 'native_spawns', 'input_tokens', 'cached_input_tokens',
              'cache_write_input_tokens', 'output_tokens')) + '\t' + str((s['outcomes'] or {}).get('status')))
    print('Tokens above: coordinator only. Child transcripts and reported CLI cost are in metrics.json; missing usage stays unknown.')
    by_arm = defaultdict(list)
    for s in reports:
        by_arm[s['arm']].append(s)
    print('\nPer arm: means, including failed runs (failures are not discarded).')
    for arm, runs in sorted(by_arm.items()):
        successful = sum((r['outcomes'] or {}).get('passed') is True for r in runs)
        means = {}
        for k in ('input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens',
                  'host_skill_loads', 'announce', 'native_spawns', 'reported_cost_usd'):
            values = [r[k] for r in runs if isinstance(r[k], (int, float))]
            means[k] = round(sum(values)/len(values), 3) if values else None
        unknown_costs = sum(r['reported_cost_usd'] is None for r in runs)
        print(f'{arm}: n={len(runs)}, artifact passes={successful}, unknown costs={unknown_costs}, means={json.dumps(means)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
