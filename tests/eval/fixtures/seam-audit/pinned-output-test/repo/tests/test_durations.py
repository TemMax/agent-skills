import unittest

from src.durations import format_duration


class TestFormatDuration(unittest.TestCase):
    def test_seconds(self):
        self.assertEqual(format_duration(45), "45s")

    def test_minutes(self):
        self.assertEqual(format_duration(125), "2m")

    def test_hours(self):
        self.assertEqual(format_duration(3720), "1h 02m")


if __name__ == "__main__":
    unittest.main()
