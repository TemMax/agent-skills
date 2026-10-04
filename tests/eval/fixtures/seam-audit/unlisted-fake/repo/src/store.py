import abc


class Store(abc.ABC):
    """A key-value store of string keys and string values."""

    @abc.abstractmethod
    def get(self, key):
        """Return the value stored under key, or None."""

    @abc.abstractmethod
    def put(self, key, value):
        """Store value under key, replacing any previous value."""
