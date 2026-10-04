status: draft
base: pending

# Plan — parse a whole settings line

Callers split `a=1; b=2` lines by hand before calling `parse_pair`. Add
`parse_line` that does it for them. One task, one wave.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a library function covered by its unit tests",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "parse-line",
     "branch": "wave/parse-line",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/parse.py"],
      "files_forbidden": ["tests/**"],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_parse", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing parse_pair's behaviour"],
      "report_must_answer": ["Show parse_line and the test run."]
     }
    }
   ]
  }
 ]
}
```

## Task parse-line

In `src/parse.py`, add `parse_line(line)`: split `line` on `;`, skip empty
segments, parse each with `parse_pair`, and return a dict (a later key wins).
An empty line returns `{}`. `parse_pair` itself is unchanged.

Base status: the `must_run` `python3 -B -m unittest tests.test_parse` is
green at base and must stay green — this task only adds a function, so the
existing parser tests are the regression guard.
