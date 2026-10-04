import unittest

from src.ratelimit import RATE_LIMIT_PER_MINUTE, allow


class RateLimitTest(unittest.TestCase):
    def test_limit_value(self):
        self.assertEqual(RATE_LIMIT_PER_MINUTE, 10)

    def test_allows_below_limit(self):
        self.assertTrue(allow(RATE_LIMIT_PER_MINUTE - 1))

    def test_blocks_at_limit(self):
        self.assertFalse(allow(RATE_LIMIT_PER_MINUTE))


if __name__ == "__main__":
    unittest.main()
