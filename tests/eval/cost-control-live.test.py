#!/usr/bin/env python3
"""Cheap fixture/expectation tests; never calls a model."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('cost-control-live.py')


class Fixtures(unittest.TestCase):
    def test_preflight_transport_does_not_spend_model_call_cap(self):
        spec = importlib.util.spec_from_file_location('live_transport', SCRIPT)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            cli = out / 'fake-cli'; cli.write_text('#!/bin/sh\nexit 0\n'); cli.chmod(0o700)
            transport = module.adapter(out, str(cli), 'codex', out, max_calls=2, inject_fault=False)
            self.assertEqual(subprocess.run([str(transport), 'sandbox', '--', 'true']).returncode, 0)
            self.assertFalse((out / 'calls.jsonl').exists())
            self.assertEqual(subprocess.run([str(transport), 'exec', '-']).returncode, 0)
            self.assertEqual(subprocess.run([str(transport), 'exec', '--output-schema', 'verdict.json', '-']).returncode, 0)
            rows = [json.loads(line) for line in (out / 'calls.jsonl').read_text().splitlines()]
            self.assertEqual([r['role'] for r in rows], ['exec', 'judge'])
            self.assertEqual(subprocess.run([str(transport), 'exec', '-'], capture_output=True).returncode, 75)

    def test_candidate_proof_resolves_fixture_paths_and_rejects_identical_other_file(self):
        spec = importlib.util.spec_from_file_location('live', SCRIPT)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); repo = root / 'repo'; repo.mkdir()
            pkg = root / 'package'
            for plugin, kind in [('orchestration', 'multi-model'), ('code-review', 'critical-review')]:
                source = pkg / 'plugins' / plugin / 'skills-codex' / kind
                source.mkdir(parents=True)
                (source / 'SKILL.md').write_text('Frozen candidate')
            module.register_workspace_skills(repo, pkg)
            expected = pkg / 'plugins/orchestration/skills-codex/multi-model/SKILL.md'
            self.assertTrue(module.candidate_read_matches(['.agents/skills/multi-model/SKILL.md'], expected, repo))
            self.assertTrue(module.candidate_read_matches([str(expected)], expected, repo))
            other = repo / 'SKILL.md'; other.write_bytes(expected.read_bytes())
            self.assertFalse(module.candidate_read_matches(['SKILL.md'], expected, repo))

    def test_handoff_accounting_includes_coordinator_and_both_children(self):
        spec = importlib.util.spec_from_file_location('handoff_accounting', SCRIPT.with_name('cost-control-live-analyze.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        for provider in ['claude', 'codex']:
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                (out / 'meta.json').write_text(json.dumps({'provider': provider, 'case': 'handoff', 'arm': 'new', 'versions': {}}))
                (out / 'wave/one').mkdir(parents=True)
                if provider == 'codex':
                    raw = {'input_tokens': 100, 'cached_input_tokens': 80, 'output_tokens': 3}
                    for role in ['executor', 'supervisor']:
                        (out / f'wave/one/{role}-1.events.jsonl').write_text('\n'.join(map(json.dumps, [
                            {'type': 'thread.started', 'thread_id': role}, {'type': 'turn.completed', 'usage': raw}])))
                    (out / 'turn-1.jsonl').write_text(json.dumps({'type': 'turn.completed', 'usage': raw}))
                else:
                    raw = {'input_tokens': 100, 'cache_creation_input_tokens': 0, 'cache_read_input_tokens': 0, 'output_tokens': 3}
                    (out / 'wave/summary.json').write_text(json.dumps({'children': [
                        {'role': role, 'result': role+'.json', 'usage': raw} for role in ['exec', 'judge']]}))
                    (out / 'turn-1.jsonl').write_text(json.dumps({'type': 'assistant', 'message': {'id': 'root', 'usage': raw}}))
                total = module.analyze(out)['whole_captured_task']
                self.assertEqual(total['captured_invocations'], 3)
                self.assertEqual(total['total_tokens'], 309)

    def test_preparation_freezes_expectations_and_uses_current_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'
            result = subprocess.run([sys.executable, str(SCRIPT), '--provider', 'claude',
                '--case', 'recovery', '--arm', 'new', '--out', str(out), '--prepare-only'],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            expected = json.loads((out / 'expected.json').read_text())
            self.assertEqual(expected['executor_calls_after_recovery'], 1)
            self.assertTrue((out / 'machine-ready').exists())
            self.assertFalse((out / 'calls.jsonl').exists())
            meta = json.loads((out / 'meta.json').read_text())
            self.assertEqual(meta['versions']['orchestration'], '4.8.0')
            self.assertEqual(subprocess.run([sys.executable, str(SCRIPT), '--provider', 'claude',
                '--case', 'recovery', '--arm', 'new', '--out', str(out), '--prepare-only'],
                capture_output=True).returncode, 73)

    def test_semantic_fixture_is_green_but_loses_a_real_invariant(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'
            result = subprocess.run([sys.executable, str(SCRIPT), '--provider', 'codex',
                '--case', 'semantic', '--arm', 'new', '--out', str(out), '--prepare-only'],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            repo = out / 'repo'
            checks = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests'],
                                    cwd=repo, capture_output=True, text=True)
            self.assertEqual(checks.returncode, 0, checks.stderr)
            self.assertIn('Ran 39 tests', checks.stderr)
            probe = subprocess.run([sys.executable, '-B', '-c',
                'from src.validator import validate; assert validate(-1) == -1'], cwd=repo)
            self.assertEqual(probe.returncode, 0)

    def test_cost_accounting_deduplicates_copied_codex_threads(self):
        spec = importlib.util.spec_from_file_location('accounting', SCRIPT.with_name('cost-control-live-analyze.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'meta.json').write_text(json.dumps({'provider': 'codex', 'case': 'recovery', 'arm': 'old', 'versions': {}}))
            for name, sid in [('first', 'a'), ('preserved-first', 'a'), ('resumed', 'b')]:
                p = out / name / 'one'; p.mkdir(parents=True)
                (p / 'executor-1.events.jsonl').write_text('\n'.join(map(json.dumps, [
                    {'type': 'thread.started', 'thread_id': sid},
                    {'type': 'turn.completed', 'usage': {'input_tokens': 100, 'cached_input_tokens': 80, 'output_tokens': 3}}])))
            result = module.analyze(out)['pipeline']
            self.assertEqual(result['captured_invocations'], 2)
            self.assertEqual(result['total_tokens'], 206)
            self.assertEqual(result['uncached_input'], 40)
            self.assertIsNone(result['cache_creation'])

    def test_resumed_codex_usage_is_not_summed_twice(self):
        spec = importlib.util.spec_from_file_location('session_accounting', SCRIPT.with_name('skill-session-ab-analyze.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            usages = [{'input_tokens': 100, 'cached_input_tokens': 80, 'output_tokens': 3},
                      {'input_tokens': 250, 'cached_input_tokens': 180, 'output_tokens': 8}]
            for i, raw in enumerate(usages, 1):
                (out / f'turn-{i}.jsonl').write_text(json.dumps({'type': 'turn.completed', 'usage': raw})+'\n')
            self.assertFalse(module.cumulative_usage_proven(str(out), usages))
            (out / 'rollout.jsonl').write_text('\n'.join(json.dumps({'type': 'event_msg', 'payload': {
                'type': 'token_count', 'info': {'total_token_usage': raw}}}) for raw in usages))
            result = module.analyze_run(str(out))
            self.assertEqual(result['summary']['usage_mode'], 'cumulative_verified_by_rollout')
            self.assertEqual(result['summary']['input_tokens'], 250)
            self.assertEqual(result['summary']['output_tokens'], 8)
            self.assertEqual(result['per_turn'][1]['input_tokens'], 150)

    def test_native_guard_facts_accept_both_host_formats_and_final_exit(self):
        spec = importlib.util.spec_from_file_location('guards', SCRIPT.with_name('cost-control-guards.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            native = {'mustRun': [{'attempts': [{'exit': 9}, {'exit': 0}]}]}
            path = out / 'native-state.json'
            path.write_text(json.dumps({'tasks': {'one': {'verifierFacts': [native]}}}))
            facts = module.verifier_facts({'states': [str(path)]}, out)
            self.assertEqual(len(facts), 1)
            self.assertEqual(module.final_exit(facts[0]['mustRun'][0]), 0)
            (out / 'verification-1.json').write_text(json.dumps({'mustRun': [{'exit': 9}]}))
            facts = module.verifier_facts({}, out)
            self.assertEqual(module.final_exit(facts[0]['mustRun'][0]), 9)


if __name__ == '__main__':
    unittest.main()
