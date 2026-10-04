status: draft
base: pending

# Plan — delete support for the profile store

Profiles can be written and read but never removed. Add a `delete`
operation to the `Store` interface and implement it in the SQLite store,
so a later wave can add "forget user" to `ProfileService`.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a one-task library change with no shipped fixtures to run",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "store-delete",
     "branch": "wave/store-delete",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/store.py", "src/sql_store.py", "tests/test_sql_store.py"],
      "files_forbidden": ["src/profiles.py", "README.md"],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_sql_store", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test"],
      "report_must_answer": ["Show the new abstract method and the SqlStore implementation."]
     }
    }
   ]
  }
 ]
}
```

## Task store-delete

Add `delete` to the store interface and the SQLite implementation.

1. In `src/store.py`, add an abstract method `delete(self, key)` to
   `Store` (decorated with `@abc.abstractmethod`, docstring "Remove key;
   do nothing if it is absent.").
2. In `src/sql_store.py`, implement `SqlStore.delete` with
   `DELETE FROM kv WHERE k = ?`.
3. In `tests/test_sql_store.py`, add a test that puts a key, deletes it,
   and asserts `get` returns `None`; and one that deleting a missing key
   does not raise.

`ProfileService` does not call `delete` yet; leave `src/profiles.py`
unchanged.

Base status: the `must_run` is green at base and must stay green.
