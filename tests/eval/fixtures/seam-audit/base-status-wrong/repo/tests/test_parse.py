import unittest

from src.parse import parse_line, parse_pair


class TestParsePair(unittest.TestCase):
    def test_pair(self):
        self.assertEqual(parse_pair(" a = 1 "), ("a", "1"))

    def test_bad_pair(self):
        with self.assertRaises(ValueError):
            parse_pair("novalue")


class TestParseLine(unittest.TestCase):
    def test_line(self):
        self.assertEqual(parse_line("a=1; b=2"), {"a": "1", "b": "2"})

    def test_empty_line(self):
        self.assertEqual(parse_line(""), {})


if __name__ == "__main__":
    unittest.main()
