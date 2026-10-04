import unittest

from src.sql_store import SqlStore


class SqlStoreTest(unittest.TestCase):
    def test_put_then_get(self):
        store = SqlStore()
        store.put("a", "1")
        self.assertEqual(store.get("a"), "1")

    def test_missing_key_is_none(self):
        self.assertIsNone(SqlStore().get("nope"))


if __name__ == "__main__":
    unittest.main()
