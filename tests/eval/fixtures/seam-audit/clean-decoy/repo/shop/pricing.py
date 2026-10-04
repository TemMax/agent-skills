from shop.constants import TAX_RATE


def gross(net):
    """Price including tax, rounded to cents."""
    return round(net * (1 + TAX_RATE), 2)
