import sqlite3

from src.store import Store


class SqlStore(Store):
    """A Store backed by an SQLite database (in memory by default)."""

    def __init__(self, path=":memory:"):
        self._db = sqlite3.connect(path)
        self._db.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)")

    def get(self, key):
        row = self._db.execute("SELECT v FROM kv WHERE k = ?", (key,)).fetchone()
        return row[0] if row else None

    def put(self, key, value):
        self._db.execute("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (key, value))
