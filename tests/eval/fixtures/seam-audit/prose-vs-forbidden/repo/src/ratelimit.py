"""Per-client request limiting."""

RATE_LIMIT_PER_MINUTE = 10


def allow(requests_this_minute):
    """Return True when one more request fits in the current minute."""
    return requests_this_minute < RATE_LIMIT_PER_MINUTE
