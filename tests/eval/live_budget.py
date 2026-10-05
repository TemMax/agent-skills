"""Persistent aggregate stop guard for a sequential native-host evaluation.

Calls are reserved before launch. A pending/unknown attempt blocks continuation;
failed calls are charged too. Tokens are measured after a call, so one call may
cross the token threshold. Claude receives the remaining USD cap before launch.
"""
import fcntl
import json
from pathlib import Path
from contextlib import contextmanager


class Budget:
    def __init__(self, path):
        self.path = Path(path)

    @classmethod
    def create(cls, path, limits):
        path = Path(path)
        if any(not isinstance(limits[k], (int, float)) or limits[k] <= 0
               for k in ['calls', 'tokens', 'claude_usd']):
            raise ValueError('Positive aggregate limits required')
        with path.open('x') as f:
            json.dump({'limits': limits, 'attempts': []}, f, indent=2)
        return cls(path)

    @contextmanager
    def locked(self):
        with self.path.open('r+') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            data = json.load(f)
            yield data
            f.seek(0); json.dump(data, f, indent=2); f.truncate(); f.flush()

    def reserve(self, label):
        with self.locked() as data:
            rows = data['attempts']; limits = data['limits']
            if any(r.get('tokens') is None or r.get('claude_usd') is None for r in rows):
                raise RuntimeError('Pending or unmeasured attempt: reconcile retained evidence before continuing')
            totals = {k: sum(r[k] for r in rows) for k in ['tokens', 'claude_usd']}
            if len(rows) >= limits['calls'] or any(totals[k] >= limits[k] for k in totals):
                raise RuntimeError('Aggregate live budget reached')
            index = len(rows)
            rows.append({'label': label, 'tokens': None, 'claude_usd': None})
            return index, limits['claude_usd'] - totals['claude_usd']

    def record(self, index, *, tokens, claude_usd, complete, evidence):
        for value in [tokens, claude_usd]:
            if value is not None and (not isinstance(value, (int, float)) or value < 0):
                raise ValueError('Invalid usage')
        with self.locked() as data:
            row = data['attempts'][index]
            if 'complete' in row:
                raise RuntimeError('Attempt already accounted; no reset or double recording')
            row.update(tokens=tokens, claude_usd=claude_usd, complete=complete, evidence=str(evidence))
