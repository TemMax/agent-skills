#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('replay', Path(__file__).with_name('acceptance-dialogue-replay.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class ReplayTests(unittest.TestCase):
    def fixture(self, root):
        run = root / 'retained'; run.mkdir()
        texts = ['Прочитаю инструкции скилла.', 'Проверка завершена.']
        for k, text in enumerate(texts, 1):
            row = {'type': 'item.completed', 'item': {'id': 'item_0', 'type': 'agent_message', 'text': text}}
            (run / f'turn-{k}.jsonl').write_text(json.dumps(row)+'\n')
        (run / 'outcomes.json').write_text(json.dumps({'passed': True, 'checks': {'quiet': True}}))
        return run

    def test_replay_corrects_quiet_only_and_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); run = self.fixture(root)
            before = {p.name: p.read_bytes() for p in run.iterdir()}
            result = m.replay([run], root / 'replay')
            self.assertEqual((result['run_count'], result['turn_count'], result['changed_count'], result['new_model_calls']), (1, 2, 1, 0))
            self.assertFalse(result['runs'][0]['quiet'])
            self.assertNotIn('passed', result)
            self.assertEqual(before, {p.name: p.read_bytes() for p in run.iterdir()})
            turns = json.loads((root / 'replay/run-1.json').read_text())['turns']
            self.assertEqual([t['quiet'] for t in turns], [False, True])
            with self.assertRaises(FileExistsError): m.replay([run], root / 'replay')

    def test_missing_turn_and_output_inside_evidence_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); run = self.fixture(root)
            with self.assertRaises(ValueError): m.replay([run], run / 'replay')
            (run / 'turn-1.jsonl').unlink()
            with self.assertRaises(ValueError): m.replay([run], root / 'replay')
            self.assertFalse((root / 'replay').exists())


if __name__ == '__main__': unittest.main()
