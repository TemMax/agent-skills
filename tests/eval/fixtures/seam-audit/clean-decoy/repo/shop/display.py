from shop.constants import CURRENCY


def format_amount(amount):
    """Render an amount as '12.50 EUR'."""
    return "%.2f %s" % (amount, CURRENCY)
