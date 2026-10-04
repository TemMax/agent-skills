"""Distance unit conversions."""

KM_PER_MILE = 1.609344


def km_to_miles(km):
    """Convert kilometres to miles, rounded to two decimals."""
    return round(km / KM_PER_MILE, 2)
