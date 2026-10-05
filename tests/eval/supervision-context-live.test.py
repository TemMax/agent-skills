import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('supervision',Path(__file__).with_name('supervision-context-live.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Fixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='supervision-context-offline-')
        cls.out=Path(cls.tmp.name)/'cases';m.prepare(cls.out)

    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()

    def test_prepare_freezes_all_cases_without_model_launches(self):
        self.assertEqual(json.loads((self.out/'budget.json').read_text())['attempts'],[])
        for host in ['claude','codex']:
            for case in m.CASES:
                dest=self.out/(host+'-'+case);f=json.loads((dest/'frozen.json').read_text())
                self.assertEqual(m.sha(dest/'plan.md'),f['plan_sha'])
                self.assertFalse(list(dest.glob('call-*')))
                self.assertEqual(f['expected']['accepted'],case!='semantic')

    def test_mismatch_is_confined_to_prompt_copy(self):
        for host in ['claude','codex']:
            dest=self.out/(host+'-mismatched')
            changed=json.loads((dest/'prompt-state.json').read_text())
            self.assertEqual(changed['tasks']['one']['verifierFacts'][-1]['verification']['head'],'0'*40)
            original=next((dest/'repo/.worktrees/codex-wave').glob('*.json'))
            stored=json.loads(original.read_text())
            self.assertNotEqual(stored['tasks']['one']['verifierFacts'][-1]['verification']['head'],'0'*40)
            self.assertEqual(len(m.read_events(dest/'pipeline-calls.jsonl')),1)

    def test_semantic_candidate_is_green_with_complete_diff_retained(self):
        dest=self.out/'codex-semantic'
        state=json.loads((dest/'prompt-state.json').read_text());facts=state['tasks']['one']['verifierFacts'][-1]
        self.assertTrue(all(c['attempts'][-1]['exit']==0 for c in facts['mustRun']))
        self.assertIn('raise ValueError',facts['diff'])
        prompt=(dest/'judge.prompt.md').read_text()
        injected=json.loads(prompt.split('VERIFIER FACTS:\n')[1].split('\nREPORT:')[0])
        self.assertNotIn('stdout',injected['git']['diff'])
        self.assertIn('git diff ',injected['diff'])
        self.assertIn('Choose the evidence path',prompt)

    def test_native_arguments_are_supported_by_each_shipped_runner(self):
        for host in ['claude','codex']:
            dest=self.out/(host+'-positive');f=json.loads((dest/'frozen.json').read_text())
            refs=dest/'package/plugins/orchestration/skills/multi-model/references'
            argv=m.native_argv(host,refs,dest,Path(f['repo']),f['base'],dest/'real-cli-adapter')
            help_text=m.b.call(argv[:2]+['--help'])
            for flag in argv[2::2]: self.assertIn(flag,help_text)

    def test_tool_evidence_does_not_accept_assistant_claims_or_failed_commands(self):
        rows=[{'type':'assistant','message':{'content':[{'type':'text','text':'All tests ran and the diff was read.'}]}},
              {'type':'item.completed','item':{'type':'command_execution','command':'python3 -B -m unittest discover -s tests','exit_code':1,'aggregated_output':'FAILED'}}]
        evidence=m.tool_evidence(rows)
        self.assertEqual(len(evidence),1);self.assertFalse(evidence[0][2])

    def test_followup_prepares_only_affected_case_and_preserves_spent_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();ledger=root/'existing.json'
            budget=m.Budget.create(ledger,{'calls':10,'tokens':1200000,'claude_usd':4})
            i,_=budget.reserve('retained-failure');budget.record(i,tokens=42,claude_usd=0,complete=False,evidence=root/'earlier')
            before=ledger.read_bytes();m.prepare(root/'followup',['codex-semantic'],ledger)
            self.assertEqual(ledger.read_bytes(),before)
            self.assertEqual(len(list((root/'followup').glob('*/frozen.json'))),1)
            cfg=json.loads((root/'followup/codex-semantic/transport.json').read_text())
            self.assertEqual(cfg['budget'],str(ledger))


if __name__=='__main__':unittest.main()
