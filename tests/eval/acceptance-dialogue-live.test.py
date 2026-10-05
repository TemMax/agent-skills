#!/usr/bin/env python3
"""Offline checks for retained native evidence and versioned fixtures; no models."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('acceptance-dialogue-live.py')
spec = importlib.util.spec_from_file_location('acceptance', SCRIPT)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class Evidence(unittest.TestCase):
    def test_complete_output_usage_requires_matching_root_input_scope(self):
        rows = [{'type': 'assistant', 'message': {'id': 'm', 'usage': {'input_tokens': 2, 'cache_creation_input_tokens': 30, 'cache_read_input_tokens': 100, 'output_tokens': 0}}},
                {'type': 'result', 'usage': {'input_tokens': 2, 'cache_creation_input_tokens': 30, 'cache_read_input_tokens': 100, 'output_tokens': 500}}]
        self.assertEqual(module.usage(rows)['output_tokens'], 500)
        rows[-1]['usage']['input_tokens'] = 999
        self.assertEqual(module.usage(rows)['output_tokens'], 0)

    def test_repository_instruction_evidence_is_not_an_assistant_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'AGENTS.md'; path.write_text('Required repository rule.\n')
            claim = {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': path.read_text()}}
            self.assertFalse(module.instructions_seen([claim], path, []))
            read = {'type': 'item.completed', 'item': {'type': 'command_execution', 'exit_code': 0, 'aggregated_output': path.read_text()}}
            self.assertTrue(module.instructions_seen([read], path, []))
            read['item']['exit_code'] = 1
            self.assertFalse(module.instructions_seen([read], path, []))

    def test_prepare_freezes_both_versions_without_calls_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'
            argv = [sys.executable, str(SCRIPT), '--provider', 'codex', '--case', 'reload', '--out', str(out), '--prepare-only']
            r = subprocess.run(argv, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            versions = json.loads((out / 'probe-versions.json').read_text())
            self.assertNotEqual(versions['v1']['marker'], versions['v2']['marker'])
            frozen = json.loads((out / 'frozen-snapshots.json').read_text())
            self.assertTrue(any(p.startswith('package-v2/') for p in frozen))
            self.assertFalse(list(out.glob('turn-*.jsonl')))
            expected = json.loads((out / 'expected.json').read_text())
            self.assertTrue(expected['fresh_session_required'])
            self.assertEqual(subprocess.run(argv, capture_output=True).returncode, 2)

    def test_uncompleted_or_wrong_version_read_does_not_prove_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'SKILL.md'
            path.write_text('---\nname: multi-model\n---\nnew-marker\n')
            row = {'type': 'item.started', 'item': {'type': 'command_execution', 'command': 'cat SKILL.md', 'aggregated_output': path.read_text()}}
            self.assertFalse(module.observed([row], path, 'new-marker'))
            row['type'] = 'item.completed'; row['item']['aggregated_output'] = 'old-marker'
            self.assertFalse(module.observed([row], path, 'new-marker'))
            row['item']['aggregated_output'] = path.read_text()
            self.assertTrue(module.observed([row], path, 'new-marker'))

    def test_claude_injection_requires_exact_body_and_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'SKILL.md'; path.write_text('---\nname: multi-model\n---\nCandidate policy.\n')
            row = {'type': 'user', 'message': {'content': [{'type': 'text', 'text': 'Base directory for this skill: '+str(path.parent)+'\nCandidate policy.'}]}}
            self.assertTrue(module.observed([row], path))
            row['message']['content'][0]['text'] += '\n\n\nARGUMENTS: Read-only assigned phase.'
            self.assertTrue(module.observed([row], path))
            row['message']['content'][0]['text'] = 'Base directory for this skill: /installed/old\nCandidate policy.'
            self.assertFalse(module.observed([row], path))

    def test_accounting_does_not_subtract_counters_across_fresh_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp); (out / 'rollouts').mkdir()
            turns = [{'turn': 1, 'sid': 'a'}, {'turn': 2, 'sid': 'a'}, {'turn': 3, 'sid': 'b'}]
            raws = [{'input_tokens': n, 'cached_input_tokens': n//2, 'output_tokens': 3} for n in [100, 250, 120]]
            for turn, raw in zip(turns, raws):
                (out / f'turn-{turn["turn"]}.jsonl').write_text(json.dumps({'type': 'turn.completed', 'usage': raw}))
                with (out / f'rollouts/{turn["sid"]}.jsonl').open('a') as f:
                    f.write(json.dumps({'type': 'event_msg', 'payload': {'info': {'total_token_usage': raw}}})+'\n')
            d = module.accounting(out, 'codex', turns)
            self.assertTrue(d['cumulative_rollout_verified'])
            self.assertEqual(d['root_usage']['input_tokens'], 370)
            self.assertEqual(d['total'], 376)

    def test_missing_rollout_is_not_a_claimed_token_total(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'turn-1.jsonl').write_text(json.dumps({'type': 'turn.completed', 'usage': {'input_tokens': 100, 'cached_input_tokens': 80, 'output_tokens': 3}}))
            d = module.accounting(out, 'codex', [{'turn': 1, 'sid': 'unknown'}])
            self.assertFalse(d['cumulative_rollout_verified'])
            self.assertIsNone(d['total'])


if __name__ == '__main__': unittest.main()
