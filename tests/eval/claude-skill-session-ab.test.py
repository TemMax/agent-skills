#!/usr/bin/env python3
"""Offline driver tests; no real model, credentials or personal transcripts."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
DRIVER = HERE / 'claude-skill-session-ab.py'


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.plugin = self.root / 'candidate'
        (self.plugin / '.claude-plugin').mkdir(parents=True)
        (self.plugin / 'skills/multi-model').mkdir(parents=True)
        (self.plugin / '.claude-plugin/plugin.json').write_text('{"name":"orchestration","version":"99.0.0"}')
        (self.plugin / 'skills/multi-model/SKILL.md').write_text('---\nname: multi-model\ndescription: test\n---\nUncommitted candidate.\n')
        self.stub = self.root / 'claude'
        self.stub.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys, time
a = sys.argv[1:]
if '--version' in a:
    print('Claude offline stub'); sys.exit(0)
prompt = sys.stdin.read()
log = pathlib.Path(os.environ['AB_STUB_LOG'])
rows = log.read_text().splitlines() if log.exists() else []
log.write_text('\\n'.join(rows + [json.dumps({'args':a,'prompt':prompt,'cwd':os.getcwd()})])+'\\n')
if os.environ.get('AB_STUB_TIMEOUT'):
    time.sleep(30)
sid = a[a.index('--resume')+1] if '--resume' in a else a[a.index('--session-id')+1]
plugin = a[a.index('--plugin-dir')+1] if '--plugin-dir' in a else '/installed/orchestration'
print(json.dumps({'type':'system','subtype':'init','session_id':sid,'plugins':[{'name':'orchestration','path':plugin,'version':'99.0.0'}]}))
if not rows:
    content = [{'type':'tool_use','id':'skill','name':'Skill','input':{'skill':'orchestration:multi-model'}},
               {'type':'tool_use','id':'read','name':'Read','input':{'file_path':plugin+'/skills/multi-model/SKILL.md'}}]
else:
    p = pathlib.Path('.github/workflows/ci.yml'); p.write_text(p.read_text().replace('timeout-minutes: 10','timeout-minutes: 15'))
    content = [{'type':'text','text':'Готово.'}]
if not rows:
    print(json.dumps({'type':'user','message':{'content':[{'type':'text','text':'Base directory for this skill: '+plugin+'/skills/multi-model\\nSkill body.'}]}}))
if os.environ.get('AB_STUB_DEDUP') and not rows:
    import ast
    remove={'test_add_two_again','test_mul_rechecks_add','test_mul_basic_duplicate','test_fmt_two_decimals_copy','test_fmt_pi_again'}
    for p in pathlib.Path('tests').glob('test_*.py'):
        lines=p.read_text().splitlines(keepends=True)
        nodes=[n for n in ast.walk(ast.parse(''.join(lines))) if isinstance(n,ast.FunctionDef) and n.name in remove]
        for n in sorted(nodes,key=lambda n:n.lineno,reverse=True): del lines[n.lineno-1:n.end_lineno]
        p.write_text(''.join(lines))
    if os.environ.get('AB_STUB_DROP_UNIQUE'):
        p=pathlib.Path('tests/test_add.py'); s=p.read_text().replace('test_add_negative','test_unrelated_case').replace('add(-5, 3), -2','add(2, 2), 4'); p.write_text(s)
for output in [2,9]:
    print(json.dumps({'type':'assistant','message':{'id':'m1','usage':{'input_tokens':3,'cache_creation_input_tokens':20,'cache_read_input_tokens':100,'output_tokens':output},'content':content}}))
print(json.dumps({'type':'assistant','parent_tool_use_id':'child','message':{'id':'child1','usage':{'input_tokens':50,'output_tokens':7},'content':[{'type':'text','text':'Профиль: это текст ребёнка.'}]}}))
fail = bool(os.environ.get('AB_STUB_FAIL'))
print(json.dumps({'type':'result','subtype':'error_max_budget_usd' if fail else 'success','is_error':fail,'session_id':sid,'total_cost_usd':None if os.environ.get('AB_STUB_MISSING_COST') else 0.1,'usage':{'input_tokens':999999}}))
''')
        self.stub.chmod(0o755)
        self.out = self.root / 'result'
        self.env = {**os.environ, 'SKILL_SESSION_AB_CLAUDE_BIN': str(self.stub),
                    'SKILL_SESSION_AB_CLAUDE_PROJECTS': str(self.root / 'projects'),
                    'AB_STUB_LOG': str(self.root / 'calls.jsonl')}

    def tearDown(self):
        self.tmp.cleanup()

    def run_driver(self, *extra):
        return subprocess.run([sys.executable, str(DRIVER), '--arm', 'new', '--out', str(self.out),
                               '--candidate-root', str(self.plugin), '--scenario', 'smoke',
                               '--turn-timeout', '10', *extra], env=self.env, capture_output=True, text=True, timeout=40)

    def test_real_driver_resumes_and_checks_frozen_candidate(self):
        result = self.run_driver()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(x) for x in (self.root / 'calls.jsonl').read_text().splitlines()]
        self.assertEqual(len(calls), 2)
        sid = calls[0]['args'][calls[0]['args'].index('--session-id')+1]
        self.assertEqual(calls[1]['args'][calls[1]['args'].index('--resume')+1], sid)
        self.assertNotIn('--no-session-persistence', calls[0]['args'])
        snapshot = self.out / 'plugin/skills/multi-model/SKILL.md'
        self.assertEqual(snapshot.read_bytes(), (self.plugin / 'skills/multi-model/SKILL.md').read_bytes())
        meta = json.loads((self.out / 'meta.json').read_text())
        self.assertEqual(meta['candidate']['version'], '99.0.0')
        self.assertTrue(json.loads((self.out / 'loaded-candidate.json').read_text())['snapshot_path_observed'])
        outcomes = json.loads((self.out / 'outcomes.json').read_text())
        self.assertTrue(outcomes['passed'], outcomes)
        self.assertEqual(outcomes['test_count'], 19)
        metrics = json.loads((self.out / 'metrics.json').read_text())
        self.assertEqual(metrics['summary']['input_tokens'], 246)
        self.assertEqual(metrics['summary']['cached_input_tokens'], 200)
        self.assertEqual(metrics['summary']['cache_write_input_tokens'], 40)
        self.assertEqual(metrics['summary']['output_tokens'], 18)
        self.assertEqual(metrics['summary']['announce'], 0)
        self.assertEqual(metrics['summary']['native_spawns'], 0)
        self.assertEqual(metrics['summary']['skill_reads_full'], 1)
        self.assertEqual(metrics['summary']['host_skill_loads'], 1)
        self.assertIsNone(metrics['summary']['total_tree_tokens'])

    def test_error_result_is_retained_and_stops_before_resume(self):
        self.env['AB_STUB_FAIL'] = '1'
        result = self.run_driver()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len((self.root / 'calls.jsonl').read_text().splitlines()), 1)
        self.assertTrue((self.out / 'turn-1.jsonl').exists())
        self.assertFalse(json.loads((self.out / 'run-status.json').read_text())['completed'])

    def test_timeout_is_failed_and_does_not_continue(self):
        self.env['AB_STUB_TIMEOUT'] = '1'
        result = self.run_driver('--turn-timeout', '1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('124', (self.out / 'turns.tsv').read_text())
        self.assertEqual(len((self.root / 'calls.jsonl').read_text().splitlines()), 1)

    def test_nonempty_results_and_invalid_args_do_not_start_cli(self):
        self.out.mkdir()
        (self.out / 'keep').write_text('keep')
        self.assertEqual(self.run_driver().returncode, 73)
        self.assertEqual((self.out / 'keep').read_text(), 'keep')
        self.assertFalse((self.root / 'calls.jsonl').exists())
        self.assertEqual(self.run_driver('--turns', '0').returncode, 2)

    def test_wrong_outcome_cannot_pass_successful_cli(self):
        result = self.run_driver('--turns', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        status = json.loads((self.out / 'outcomes.json').read_text())
        self.assertIsNone(status['passed'])
        self.assertEqual(status['status'], 'partial')

    def test_full_eight_turn_scenario_has_same_prompts_and_checks_unique_cases(self):
        self.env['AB_STUB_DEDUP'] = '1'
        result = self.run_driver('--scenario', 'duplicates')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(x) for x in (self.root / 'calls.jsonl').read_text().splitlines()]
        self.assertEqual(len(calls), 8)
        self.assertEqual(calls[1]['prompt'], 'да')
        self.assertIn('отдельная мелкая правка', calls[5]['prompt'])
        self.assertEqual(json.loads((self.out / 'outcomes.json').read_text())['test_count'], 14)

    def test_full_scenario_fails_if_duplicates_not_removed(self):
        result = self.run_driver('--scenario', 'duplicates')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads((self.out / 'outcomes.json').read_text())['status'], 'failed')

    def test_fourteen_passing_tests_do_not_hide_lost_unique_case(self):
        self.env.update(AB_STUB_DEDUP='1', AB_STUB_DROP_UNIQUE='1')
        result = self.run_driver('--scenario', 'duplicates')
        self.assertEqual(result.returncode, 1)
        outcomes = json.loads((self.out / 'outcomes.json').read_text())
        self.assertEqual(outcomes['test_count'], 14)
        self.assertTrue(outcomes['checks']['tests_pass'])
        self.assertFalse(outcomes['checks']['unique_cases_preserved'])

    def test_missing_cost_stops_before_an_unbudgeted_resume(self):
        self.env['AB_STUB_MISSING_COST'] = '1'
        result = self.run_driver()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len((self.root / 'calls.jsonl').read_text().splitlines()), 1)
        self.assertIsNone(json.loads((self.out / 'metrics.json').read_text())['summary']['reported_cost_usd'])

    def test_exhausted_cumulative_budget_stops_before_resume(self):
        result = self.run_driver('--max-budget-usd', '0.05')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len((self.root / 'calls.jsonl').read_text().splitlines()), 1)
        self.assertIn('budget exhausted', json.loads((self.out / 'run-status.json').read_text())['failure'])

    def test_claude_native_spawns_are_counted_even_with_copied_rollout(self):
        sys.path.insert(0, str(HERE))
        from claude_session_events import analyze
        self.out.mkdir()
        rows = [{'type': 'assistant', 'message': {'id': 'root', 'usage': {'input_tokens': 5}, 'content': [
            {'type': 'tool_use', 'id': 'a', 'name': 'Agent', 'input': {'prompt': 'audit seam'}},
            {'type': 'tool_use', 'id': 'e', 'name': 'Edit', 'input': {'file_path': '/missing'}}]}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'e', 'is_error': True}]}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'a', 'is_error': False}]}},
            {'type': 'result', 'subtype': 'error_max_budget_usd', 'is_error': True}]
        (self.out / 'turn-1.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
        (self.out / 'rollout.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
        report = analyze(self.out)['summary']
        self.assertEqual(report['native_spawns'], 1)
        self.assertEqual(report['input_tokens'], 5)
        self.assertEqual(report['turns_completed'], 0)
        self.assertEqual(report['coordinator_edits'], 0)

    def test_snapshot_load_cannot_be_proven_by_an_assistant_claim(self):
        sys.path.insert(0, str(HERE))
        from claude_session_events import skill_loads
        self.assertEqual(skill_loads([{'type': 'assistant', 'message': {'content': [
            {'type': 'text', 'text': 'Base directory for this skill: /made/up'}]}}]), [])


if __name__ == '__main__':
    unittest.main()
