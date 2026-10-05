#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
from live_budget import Budget

class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'budget.json'
        self.b=Budget.create(self.path,{'calls':2,'tokens':100,'claude_usd':1})
    def spend(self,tokens=50,cost=.2,complete=False):
        i,left=self.b.reserve('attempt'); self.b.record(i,tokens=tokens,claude_usd=cost,complete=complete,evidence='raw.jsonl'); return left
    def test_failed_calls_consume_cap_across_reopened_ledger(self):
        self.spend(); self.b=Budget(self.path); self.spend(tokens=10)
        with self.assertRaises(RuntimeError): self.b.reserve('retry')
    def test_token_threshold_blocks_next_call_after_overshoot(self):
        self.spend(tokens=110)
        with self.assertRaises(RuntimeError): self.b.reserve('next')
    def test_usd_threshold_and_remaining_cap(self):
        self.assertEqual(self.spend(cost=.4),1)
        self.assertAlmostEqual(self.spend(tokens=1,cost=.6),.6)
        with self.assertRaises(RuntimeError): self.b.reserve('next')
    def test_pending_attempt_cannot_be_overwritten_or_retried(self):
        self.b.reserve('crashed')
        with self.assertRaises(RuntimeError): self.b.reserve('retry')
        with self.assertRaises(FileExistsError): Budget.create(self.path,{'calls':3,'tokens':100,'claude_usd':1})
    def test_unknown_usage_and_double_record_are_rejected(self):
        i,_=self.b.reserve('failed'); self.b.record(i,tokens=None,claude_usd=None,complete=False,evidence='partial')
        with self.assertRaises(RuntimeError): self.b.reserve('retry')
        with self.assertRaises(RuntimeError): self.b.record(i,tokens=1,claude_usd=0,complete=True,evidence='invented')
    def test_negative_usage_rejected(self):
        i,_=self.b.reserve('a')
        with self.assertRaises(ValueError): self.b.record(i,tokens=-1,claude_usd=0,complete=True,evidence='x')

if __name__=='__main__': unittest.main()
