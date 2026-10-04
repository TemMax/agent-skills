status: draft
base: pending

# Plan — raise the per-client rate limit

Clients hit the limit of 10 requests per minute during normal bursts.
Raise it to 12.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a one-constant change with no shipped fixtures to run",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "raise-rate-limit",
     "branch": "wave/raise-rate-limit",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/ratelimit.py", "tests/test_ratelimit.py"],
      "files_forbidden": [],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_ratelimit", "evidence": "required" }
      ],
      "forbidden_moves": ["changing or deleting an existing test", "adding a per-client override or any new setting"],
      "report_must_answer": ["Show the changed constant and the test diff."]
     }
    }
   ]
  }
 ]
}
```

## Task raise-rate-limit

Raise the per-client rate limit from 10 to 12 requests per minute.

1. In `src/ratelimit.py`, change `RATE_LIMIT_PER_MINUTE = 10` to
   `RATE_LIMIT_PER_MINUTE = 12`. `allow` keeps its logic.
2. In `tests/test_ratelimit.py`, update `test_limit_value` so its
   expected value is `12` instead of `10`. The two boundary tests read the
   constant and need no change.

Base status: the `must_run` is green at base and must be green after the
change.
