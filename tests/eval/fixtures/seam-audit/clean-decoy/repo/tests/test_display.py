import unittest

from shop.constants import CURRENCY
from shop.display import format_amount


class FormatAmountTest(unittest.TestCase):
    def test_two_decimals_and_currency(self):
        self.assertEqual(format_amount(12.5), "12.50 " + CURRENCY)


if __name__ == "__main__":
    unittest.main()
