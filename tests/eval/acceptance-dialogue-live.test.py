#!/usr/bin/env python3
"""Offline checks for retained native evidence and versioned fixtures; no models."""
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

SCRIPT = Path(__file__).with_name('acceptance-dialogue-live.py')
spec = importlib.util.spec_from_file_location('acceptance', SCRIPT)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class Evidence(unittest.TestCase):
    def test_claude_fixture_enables_only_owned_project_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);repo=out/'repo';repo.mkdir()
            def cli(cmd,*args,**kwargs):
                self.assertEqual(cmd[cmd.index('--setting-sources')+1], 'project')
                (out/'turn-1.stdout').write_text(json.dumps({'type':'result','subtype':'success','is_error':False,'total_cost_usd':0})+'\n')
                return 0
            with patch.object(module.bench,'run_logged',side_effect=cli), redirect_stdout(io.StringIO()):
                module.Session(out,repo,'claude').invoke(1,'Fixture request',out)

    def test_native_transport_requires_owned_home_and_preserves_plugin_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);repo=out/'repo';repo.mkdir();home=out/'codex-home';home.mkdir()
            with self.assertRaises(ValueError): module.Session(out,repo,'codex',native_plugins=True)
            def cli(cmd,*args,**kwargs):
                self.assertIn('--enable',cmd);self.assertNotIn('--disable',cmd)
                self.assertNotIn('--ignore-user-config',cmd)
                (out/'turn-1.stdout').write_text(json.dumps({'type':'turn.completed'})+'\n')
                return 0
            with patch.dict(os.environ,{'CODEX_HOME':str(home)}), \
                 patch.object(module,'register') as register, \
                 patch.object(module.bench,'run_logged',side_effect=cli), redirect_stdout(io.StringIO()):
                module.Session(out,repo,'codex',native_plugins=True).invoke(1,'Fixture request',out)
                register.assert_not_called()

    def test_skill_announcements_fail_but_task_updates_pass(self):
        for text in ['Использую orchestration:multi-model: проверю README.',
                     'Применяю навык critical-review для проверки.',
                     'Using $super-plan to inspect CI.',
                     'Сначала найду AGENTS.md и CLAUDE.md, затем проверю CI.']:
            with self.subTest(text=text): self.assertFalse(module.quiet(text))
        self.assertTrue(module.quiet('Проверю README и сверю таймаут с CI.'))
        self.assertTrue(module.quiet('Удалённая проверка нарушает инвариант из AGENTS.md.'))
        self.assertFalse(module.quiet('Сначала нужно найти AGENTS.md и CLAUDE.md.'))

    def test_loading_review_method_is_internal_instruction_narration(self):
        for text in ['Загружаю методику ревью, затем перехожу к диффу.', 'Читаю методику проверки.', 'Loading the review methodology before the diff.']:
            with self.subTest(text=text): self.assertFalse(module.quiet(text))
        self.assertTrue(module.quiet('Проверю методику расчёта скидки в src/pricing.py.'))

    def test_readme_citation_is_not_instruction_loading_narration(self):
        for text,expected in [
            ('Сначала читаю инструкции репозитория.',False),
            ('Reading AGENTS.md before reviewing the diff.',False),
            ('Loaded instructions before reviewing the diff.',False),
            ('Used instructions before reviewing.',False),
            ('README и AGENTS.md требуют сохранить проверку отрицательных значений.',True),
        ]:
            with self.subTest(text=text):self.assertEqual(module.quiet(text),expected)

    def test_reused_codex_ids_preserve_early_messages_and_failure(self):
        first = [
            {'type': 'item.completed', 'item': {'id': 'item_0', 'type': 'agent_message', 'text': 'Прочитаю инструкции скилла.'}},
            {'type': 'item.completed', 'item': {'id': 'item_1', 'type': 'agent_message', 'text': 'CI timeout: 10.'}},
        ]
        second = [
            {'type': 'item.completed', 'item': {'id': 'item_0', 'type': 'agent_message', 'text': 'Проверю README и CI.'}},
            {'type': 'item.completed', 'item': {'id': 'item_1', 'type': 'agent_message', 'text': 'README says 15; CI uses 10.'}},
        ]
        self.assertEqual(module.messages(first + second), '\n'.join(r['item']['text'] for r in first + second))
        self.assertFalse(module.quiet(module.messages(first + second)))
        report = module.communication_checks([first, second])
        self.assertFalse(report['quiet'])
        self.assertEqual([t['quiet'] for t in report['turns']], [False, True])
        self.assertEqual([t['turn'] for t in report['turns']], [1, 2])

    def test_reused_claude_message_ids_preserve_both_turns(self):
        first = [{'type': 'assistant', 'message': {'id': 'same', 'content': [{'type': 'text', 'text': 'Выбираю профиль модели.'}]}}]
        second = [{'type': 'assistant', 'message': {'id': 'same', 'content': [{'type': 'text', 'text': 'Проверка завершена.'}]}}]
        self.assertEqual(module.messages(first + second), 'Выбираю профиль модели.\nПроверка завершена.')
        self.assertEqual([t['quiet'] for t in module.communication_checks([first, second])['turns']], [False, True])

    def test_only_completed_root_text_is_communication_evidence(self):
        rows = [
            {'type': 'item.started', 'item': {'type': 'agent_message', 'text': 'Прочитаю инструкции.'}},
            {'type': 'item.completed', 'item': {'type': 'command_execution', 'aggregated_output': 'Профиль: internal'}},
            {'type': 'assistant', 'parent_tool_use_id': 'child', 'message': {'content': [{'type': 'text', 'text': 'Профиль: child'}]}},
            {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Проверю CI.'}, {'type': 'tool_use', 'name': 'Read', 'input': {}}]}},
        ]
        self.assertEqual(module.messages(rows), 'Проверю CI.')
        self.assertTrue(module.communication_checks([rows])['quiet'])
        self.assertFalse(module.communication_checks([])['quiet'])

    def test_dialogue_driver_persists_each_turn_without_native_calls(self):
        class FakeSession:
            def __init__(self, *args): self.turns = []
            def invoke(self, k, *args):
                self.turns.append({'turn': k, 'complete': True, 'exit': 0})
                text = 'Прочитаю инструкции скилла.' if k == 1 else 'Проверка завершена.'
                return [{'type': 'item.completed', 'item': {'id': 'item_0', 'type': 'agent_message', 'text': text}}]
        original_call = module.bench.call
        def offline_call(cmd, *args, **kwargs):
            return 'offline-cli' if cmd == ['offline-cli', '--version'] else original_call(cmd, *args, **kwargs)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'
            argv = [str(SCRIPT), '--provider', 'codex', '--case', 'decision', '--out', str(out)]
            with patch.object(sys, 'argv', argv), patch.object(module, 'Session', FakeSession), \
                 patch.object(module.shutil, 'which', return_value='offline-cli'), \
                 patch.object(module.bench, 'call', side_effect=offline_call), \
                 patch.object(module, 'accounting', return_value={}), redirect_stdout(io.StringIO()):
                module.main()
            report = json.loads((out / 'communication.json').read_text())
            self.assertEqual([t['quiet'] for t in report['turns']], [False, True])
            self.assertFalse(json.loads((out / 'outcomes.json').read_text())['checks']['quiet'])

    def test_failed_native_turn_retains_communication_before_raising(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp); repo = out / 'repo'; repo.mkdir()
            row = {'type': 'item.completed', 'item': {'id': 'item_0', 'type': 'agent_message', 'text': 'Прочитаю инструкции скилла.'}}
            def failed_cli(*args, **kwargs):
                (out / 'turn-1.stdout').write_text(json.dumps(row)+'\n')
                return 1
            with patch.object(module.shutil, 'which', return_value='offline-cli'), \
                 patch.object(module, 'register'), patch.object(module.bench, 'run_logged', side_effect=failed_cli), \
                 redirect_stdout(io.StringIO()):
                session = module.Session(out, repo, 'codex')
                with self.assertRaises(RuntimeError): session.invoke(1, 'Fixture request', out)
            report = json.loads((out / 'communication.json').read_text())
            self.assertFalse(report['quiet'])
            self.assertIn('инструкции', report['turns'][0]['messages'])

    def test_complete_output_usage_requires_matching_root_input_scope(self):
        rows = [{'type': 'assistant', 'message': {'id': 'm', 'usage': {'input_tokens': 2, 'cache_creation_input_tokens': 30, 'cache_read_input_tokens': 100, 'output_tokens': 0}}},
                {'type': 'result', 'usage': {'input_tokens': 2, 'cache_creation_input_tokens': 30, 'cache_read_input_tokens': 100, 'output_tokens': 500}}]
        self.assertEqual(module.usage(rows)['output_tokens'], 500)
        rows[-1]['usage']['input_tokens'] = 999
        self.assertEqual(module.usage(rows)['output_tokens'], 0)

    def test_native_claude_instructions_require_exact_file_body_before_first_answer(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'AGENTS.md';path.write_text('Required repository rule.\n')
            trace=Path(tmp)/'native.jsonl'
            event={'type':'attachment','attachment':{'type':'instructions','files':[{'path':str(path),'type':'Project','content':path.read_text().strip()}]}}
            reply={'type':'assistant','message':{'content':[{'type':'text','text':'Done'}]}}
            for rows,expected in [([event,reply],True),([reply,event],False)]:
                trace.write_text('\n'.join(map(json.dumps,rows)))
                self.assertEqual(module.instructions_seen([],path,[trace]),expected)
            event['attachment']['files'][0]['content']='Partial rule'
            trace.write_text(json.dumps(event))
            self.assertFalse(module.instructions_seen([],path,[trace]))
            event['attachment']['files'][0].update(path=str(path.parent/'other.md'),content=path.read_text().strip())
            trace.write_text(json.dumps(event))
            self.assertFalse(module.instructions_seen([],path,[trace]))

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
            current = json.loads((module.ROOT / 'plugins/orchestration/.claude-plugin/plugin.json').read_text())['version']
            self.assertEqual(versions['v1']['version'], current)
            for sub, key in [('package', 'v1'), ('package-v2', 'v2')]:
                body = module.skill_path(out / sub, 'codex', 'multi-model').read_text()
                self.assertIn('  version: '+versions[key]['version'], body)
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
