import unittest
from src.config import load_name


class Tests(unittest.TestCase):
    def test_name(self):
        self.assertEqual(load_name({}), "app")
