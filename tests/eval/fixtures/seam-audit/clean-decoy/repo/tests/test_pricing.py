import unittest

from shop.constants import TAX_RATE
from shop.pricing import gross


class GrossTest(unittest.TestCase):
    def test_adds_tax(self):
        self.assertEqual(gross(10), round(10 * (1 + TAX_RATE), 2))

    def test_zero(self):
        self.assertEqual(gross(0), 0)


if __name__ == "__main__":
    unittest.main()
