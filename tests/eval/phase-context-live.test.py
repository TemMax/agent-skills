#!/usr/bin/env python3
"""Offline fixture/evidence checks, never native model calls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
import io
import os
spec=importlib.util.spec_from_file_location('phase',Path(__file__).with_name('phase-context-live.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class FixtureTests(unittest.TestCase):
    def test_startup_context_requires_host_delivery_before_first_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'rollout.jsonl'
            def event(role,text):
                return {'type':'response_item','payload':{'type':'message','role':role,'content':[{'type':'input_text','text':text}]}}
            hook=event('developer','PLUGIN_RUNTIME_CONTEXT_V1 plugin=orchestration host=codex model=gpt-6.1-sol effort=medium\nUser-facing updates state the task, checks and results.')
            reply=event('assistant','Проверю CI.')
            for rows,expected in [([hook,reply],True),([reply,hook],False),([event('user',hook['payload']['content'][0]['text']),reply],False),([],False)]:
                path.write_text('\n'.join(json.dumps(r) for r in rows))
                self.assertEqual(m.startup_communication_context([path]),expected)

    def test_native_home_is_restored_after_failed_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);d=out/'codex-new-lookup';d.mkdir();(d/'codex-home').mkdir()
            (d/'meta.json').write_text(json.dumps({'codex_native_plugins':True}))
            def failed(*args):
                self.assertEqual(os.environ['CODEX_HOME'],str(d/'codex-home'))
                raise RuntimeError('Fixture failure')
            with patch.dict(os.environ,{'CODEX_HOME':'original-home'}),patch.object(m,'_run_case',side_effect=failed):
                with self.assertRaises(RuntimeError):m.run_case(out,d.name)
                self.assertEqual(os.environ['CODEX_HOME'],'original-home')

    def test_phase_driver_checks_every_turn_without_native_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'run';m.prepare(out,selected=['assigned'],providers=['codex'])
            def invoke(session,k,*args):
                session.turns.append({'turn':k,'complete':True,'exit':0})
                text='Прочитаю инструкции скилла.' if k==1 else 'Проверка завершена.'
                return [{'type':'item.completed','item':{'id':'item_0','type':'agent_message','text':text}}]
            with patch.object(m,'budget_invoke',side_effect=invoke), patch.object(m.a,'accounting',return_value={}), redirect_stdout(io.StringIO()):
                m.run_case(out,'codex-new-assigned')
            d=out/'codex-new-assigned';report=json.loads((d/'communication.json').read_text())
            self.assertEqual([t['quiet'] for t in report['turns']],[False,True,True])
            self.assertFalse(json.loads((d/'outcomes.json').read_text())['checks']['quiet'])

    def test_frozen_matrix_and_semantic_defect_despite_green_tests(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'run'; m.prepare(out,include_baseline=True)
            matrix=json.loads((out/'matrix.json').read_text())
            self.assertEqual(matrix['initial_calls'],20); self.assertEqual(len(matrix['cases']),12)
            self.assertEqual(matrix['limits']['calls'],24)
            for case in matrix['cases']:
                d=out/f"{case['provider']}-{case['arm']}-{case['case']}"
                self.assertTrue((d/'expected.json').exists()); self.assertTrue((d/'frozen.json').exists())
                self.assertFalse(list(d.glob('turn-*.jsonl')))
            repo=out/'codex-new-assigned/repo'
            r=subprocess.run(['python3','-B','-m','unittest','discover','-s','tests'],cwd=repo,capture_output=True,text=True)
            self.assertEqual(r.returncode,0,r.stderr); self.assertIn('41 tests',r.stderr)
            r=subprocess.run(['python3','-B','-c','from src.validator import validate; print(validate(-1))'],cwd=repo,capture_output=True,text=True)
            self.assertEqual(r.stdout.strip(),'-1')
            # PR service rejects a diff before the complete ledger and every write.
            d=out/'codex-new-pr-review'; gh=d/'gh'
            self.assertNotEqual(subprocess.run([str(gh),'pr','diff','17'],capture_output=True).returncode,0)
            r=subprocess.run([str(gh),'api','graphql','--paginate'],capture_output=True,text=True)
            pages=[json.loads(s) for s in r.stdout.splitlines()]
            self.assertEqual(len(pages),2)
            self.assertNotEqual(subprocess.run([str(gh),'api','graphql','--method','POST'],capture_output=True).returncode,0)
            (d/'ledger.json').write_text(json.dumps({'ids':['THREAD_1','THREAD_2'],'roots':[101,102],'viewerCanReply':True,'viewerCanResolve':True}))
            self.assertEqual(subprocess.run([str(gh),'pr','diff','17'],capture_output=True).returncode,0)
    def test_plain_phase_resource_requires_observed_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'PROFILE.md'; path.write_text('Mandatory guard.\n')
            claim={'type':'item.completed','item':{'type':'agent_message','text':path.read_text()}}
            self.assertFalse(m.a.observed([claim],path))
            read={'type':'item.completed','item':{'type':'command_execution','aggregated_output':path.read_text()}}
            self.assertTrue(m.a.observed([read],path))

    def test_scope_diff_cannot_precede_profile_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'reviewer-generic.md';path.write_text('Selected guard.\n')
            loaded={'type':'item.completed','item':{'type':'command_execution','command':'cat '+str(path),'aggregated_output':path.read_text()}}
            diff={'type':'item.completed','item':{'type':'command_execution','command':'git status --short && git diff','aggregated_output':'changed code'}}
            self.assertTrue(m.a.observed(m.before_code([loaded,diff],Path(tmp)),path))
            self.assertFalse(m.a.observed(m.before_code([diff,loaded],Path(tmp)),path))
            scope={'type':'item.completed','item':{'type':'command_execution','command':'git status --short','aggregated_output':'M README.md'}}
            self.assertTrue(m.a.observed(m.before_code([scope,loaded,diff],Path(tmp)),path))
    def test_reviewer_qualified_disclosure_is_not_quiet(self):
        self.assertFalse(m.a.quiet('Профиль ревьюера generic: модель вне таблицы калибровки.'))
        self.assertFalse(m.a.quiet('Нужно загрузить PROFILE.md перед чтением кода.'))
        self.assertTrue(m.a.quiet('Проверка нашла нарушение запрета отрицательных значений.'))

    def test_lookup_and_local_review_only_prepare_four_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'focused';m.prepare(out,selected=['lookup','local-review'])
            matrix=json.loads((out/'matrix.json').read_text())
            self.assertEqual(matrix['initial_calls'],4)
            for case in matrix['cases']:
                d=out/f"{case['provider']}-{case['arm']}-{case['case']}"
                expected=json.loads((d/'expected.json').read_text())
                if case['case']=='local-review':self.assertIn('before any artifact launch',expected['phase_rules'])
                self.assertEqual(json.loads((d/'meta.json').read_text())['prompts'],1)
    def test_instruction_narration_without_filenames_is_not_quiet(self):
        for text in ['Для read-only пропускаю выбор профиля.', "I'll read the skill instructions first.", 'Загружу скилл, потом проверю таймаут.', 'Здесь скилл говорит пропустить шаги.']:
            with self.subTest(text=text):self.assertFalse(m.a.quiet(text))
        self.assertTrue(m.a.quiet('Проверю таймаут CI и изменение валидатора.'))

    def test_lint_narration_or_instruction_example_cannot_prove_execution(self):
        claim={'type':'item.completed','item':{'type':'agent_message','text':'Plan lint passed: OK: 0 error(s)'}}
        read={'type':'item.completed','item':{'type':'command_execution','command':'cat WORKFLOW.md','aggregated_output':'Example: OK: 0 error(s)'}}
        self.assertFalse(m.lint_passed([claim,read]))
        actual={'type':'item.completed','item':{'type':'command_execution','command':'node /candidate/plan-lint.mjs /fixture/plan.md','aggregated_output':'OK: 0 error(s), 1 warning(s)'}}
        self.assertTrue(m.lint_passed([actual]))
    def test_bash_repository_read_requires_full_completed_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'AGENTS.md';p.write_text('Full repository instruction.\n')
            call={'type':'assistant','message':{'content':[{'type':'tool_use','id':'read','name':'Bash','input':{'command':'cat repo/AGENTS.md'}}]}}
            result={'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':'read','content':p.read_text()}]}}
            self.assertTrue(m.a.instructions_seen([call,result],p,[]))
            self.assertFalse(m.a.instructions_seen([call],p,[]))
            result['message']['content'][0]['content']='Repository instruction mentioned.'
            self.assertFalse(m.a.instructions_seen([call,result],p,[]))

    def test_default_skips_baselines_and_selection_freezes_only_affected_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'targeted';m.prepare(out,selected=['fix-blocked'])
            matrix=json.loads((out/'matrix.json').read_text())
            self.assertEqual(matrix['initial_calls'],2)
            self.assertEqual(matrix['limits']['calls'],6)
            self.assertEqual(len(matrix['cases']),2)
            self.assertTrue(all(case['arm']=='new' for case in matrix['cases']))
            self.assertIsNone(matrix['baseline'])
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'one-host';m.prepare(out,selected=['fix-blocked'],providers=['codex'])
            matrix=json.loads((out/'matrix.json').read_text())
            self.assertEqual(matrix['initial_calls'],1)
            self.assertEqual(matrix['cases'],[{'provider':'codex','arm':'new','case':'fix-blocked'}])
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):m.prepare(Path(tmp)/'invalid',selected=['pr-review'],include_baseline=True)

if __name__=='__main__':unittest.main()
