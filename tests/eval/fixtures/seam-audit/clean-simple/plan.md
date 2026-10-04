status: draft
base: pending

# Plan — miles to kilometres

The units module converts kilometres to miles only. Add the reverse
conversion.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a one-function library addition with no shipped fixtures to run",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "miles-to-km",
     "branch": "wave/miles-to-km",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/units.py", "tests/test_units.py"],
      "files_forbidden": [],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_units", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing km_to_miles or KM_PER_MILE"],
      "report_must_answer": ["Show the new function and its tests."]
     }
    }
   ]
  }
 ]
}
```

## Task miles-to-km

Add `miles_to_km` beside `km_to_miles`.

1. In `src/units.py`, add `miles_to_km(miles)` returning
   `round(miles * KM_PER_MILE, 2)`, with a docstring in the style of
   `km_to_miles`. Leave `km_to_miles` and `KM_PER_MILE` unchanged.
2. In `tests/test_units.py`, add a new `MilesToKmTest` class: a marathon
   (`miles_to_km(26.2)` is `42.16`) and zero. Do not modify the existing
   `KmToMilesTest` tests.

`tests/test_units.py` is the only reader of `src/units.py`.

Base status: the `must_run` is green at base (the two existing tests
pass) and must stay green with the new tests added.
