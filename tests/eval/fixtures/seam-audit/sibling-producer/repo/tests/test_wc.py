import unittest

from src.wc import count


class TestCount(unittest.TestCase):
    def test_count(self):
        self.assertEqual(count("a b\nc\n"), {"lines": 2, "words": 3, "chars": 6})


if __name__ == "__main__":
    unittest.main()
