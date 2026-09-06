#!/usr/bin/env python3
"""Run the supervisor fixture's tests with stable, compact evidence."""

import io
import unittest


suite = unittest.defaultTestLoader.discover("tests", top_level_dir=".")
result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
print(f"{'PASS' if result.wasSuccessful() else 'FAIL'} {result.testsRun}")
raise SystemExit(0 if result.wasSuccessful() else 1)
