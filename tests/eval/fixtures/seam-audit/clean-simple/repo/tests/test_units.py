import unittest

from src.units import km_to_miles


class KmToMilesTest(unittest.TestCase):
    def test_marathon(self):
        self.assertEqual(km_to_miles(42.195), 26.22)

    def test_zero(self):
        self.assertEqual(km_to_miles(0), 0)


if __name__ == "__main__":
    unittest.main()
