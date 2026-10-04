status: draft
base: pending

# Plan — owner in the job summary

The dashboard wants to show who owns each job. Records already carry an
optional `owner` field; the summary the API returns does not expose it yet.
One task, one wave.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a single-key API addition with no shipped end-to-end flow",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "summary-owner",
     "branch": "wave/summary-owner",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/summary.py"],
      "files_forbidden": ["src/durations.py"],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_durations", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test"],
      "report_must_answer": ["Show the new status_summary return value for a record with and without an owner."]
     }
    }
   ]
  }
 ]
}
```

## Task summary-owner

In `src/summary.py`, add an `owner` key to the dict `status_summary` returns:
`record.get("owner")`, so a record without an owner yields `None`. This is
purely additive — every other output is unchanged: `id`, `state`, `done` and
`attempts` keep their names and values.

Base status: the `must_run` is green at base and must stay green.
