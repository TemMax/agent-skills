status: draft
base: pending

# Plan — duration timeouts

A parser for duration strings ("1h30m", "45s", "2m") and a config reader that
uses it.

## Review Focus

- An empty or malformed duration string: `parse_duration` raises `ValueError`.
  Pinned by `test_rejects_malformed` in `parser`.

## Parallelism

- Wave 1 (`parser`) is a single task: `timeout` imports what it produces.
- Wave 2 (`timeout`) is a single task: it is the only consumer.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a library function and one reader, no pipeline",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "parser",
     "branch": "wave/parser",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "contract": {
      "files_allowed": ["src/durations.py", "tests/test_durations.py"],
      "files_forbidden": ["src/config.py"],
      "must_run": [{ "cmd": "python3 -B -m unittest tests.test_durations", "evidence": "required" }],
      "forbidden_moves": ["weakening, deleting or skipping an existing test"],
      "report_must_answer": ["Which inputs raise ValueError?"]
     }
    }
   ]
  },
  {
   "wave": 2,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "timeout",
     "branch": "wave/timeout",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "contract": {
      "files_allowed": ["src/config.py", "tests/test_config.py"],
      "files_forbidden": ["src/durations.py"],
      "must_run": [{ "cmd": "python3 -B -m unittest tests.test_config", "evidence": "required" }],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing load_name"],
      "report_must_answer": ["What does load_timeout return for a missing key?"]
     }
    }
   ]
  }
 ]
}
```

## Task parser

Create `src/durations.py` with `parse_duration(text: str) -> int`: the full
string matches `(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?` with at least one part;
the result is whole seconds. Anything else raises `ValueError`.

**Interfaces**

- Consumes: nothing.
- Produces: `src.durations.parse_duration(text: str) -> int`.

**Tests** — new `tests/test_durations.py`: `test_examples` asserts
`parse_duration("1h30m") == 5400`, `parse_duration("45s") == 45`,
`parse_duration("2m") == 120`; `test_rejects_malformed` asserts `ValueError`
for `""`, `"5x"` and `"30m1h"`.

**Verification:** `python3 -B -m unittest tests.test_durations` is
expected-red at base (the module does not exist) and passes after the task.

## Task timeout

Add `load_timeout(config: dict) -> int` to `src/config.py`: it reads
`config["timeout"]` and converts it with the wave-1 parser; a missing key
returns 30. Leave `load_name` unchanged.

**Interfaces**

- Consumes: `src.durations.parse_duration(text: str) -> int` from wave 1;
  `src.config.load_name(config: dict) -> str` at the base.
- Produces: `src.config.load_timeout(config: dict) -> int`.

**Tests** — in `tests/test_config.py`, keep `test_name` and add
`test_timeout`: `load_timeout({"timeout": "2m"}) == 120` and
`load_timeout({}) == 30`.

**Verification:** `python3 -B -m unittest tests.test_config` is green at base
and stays green.
