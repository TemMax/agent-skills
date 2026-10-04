from src.store import Store


class FakeStore(Store):
    """An in-memory Store for unit tests."""

    def __init__(self):
        self.data = {}

    def get(self, key):
        return self.data.get(key)

    def put(self, key, value):
        self.data[key] = value
