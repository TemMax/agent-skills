# profiles

A tiny profile service over a key-value `Store`.

- `src/store.py` — the abstract `Store` interface.
- `src/sql_store.py` — `SqlStore`, the SQLite-backed implementation.
- `src/profiles.py` — `ProfileService`, which reads and writes through any `Store`.

Run the tests with `python3 -B -m unittest discover -s tests -t .`.
