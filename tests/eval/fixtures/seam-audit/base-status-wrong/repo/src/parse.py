def parse_pair(token):
    """Parse 'key=value' into ('key', 'value'); surrounding spaces are stripped."""
    key, sep, value = token.partition("=")
    if not sep or not key.strip():
        raise ValueError(f"not a key=value pair: {token!r}")
    return key.strip(), value.strip()
