status: draft
base: pending

# Plan — machine-readable output for wc

Scripts that call `wc` scrape its `key: value` lines. Add a `--json` flag
that prints the counts as one JSON object, and document it. The code and the
README are separate files, so the two tasks run side by side in one wave.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a CLI flag covered by its unit test; no shipped end-to-end flow",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "cli-json-flag",
     "branch": "wave/cli-json-flag",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/wc.py", "tests/test_wc.py"],
      "files_forbidden": ["README.md"],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_wc", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing the default text output"],
      "report_must_answer": ["Paste the output of python3 -B -m src.wc --json sample.txt."]
     }
    },
    {
     "id": "docs-json-flag",
     "branch": "wave/docs-json-flag",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["README.md"],
      "files_forbidden": ["src/**", "tests/**"],
      "must_run": [
       { "cmd": "grep -qF -- '--json' README.md", "evidence": "required" }
      ],
      "forbidden_moves": ["changing the existing Usage example"],
      "report_must_answer": ["Paste the README section you added."]
     }
    }
   ]
  }
 ]
}
```

## Task cli-json-flag

In `src/wc.py`, add a `--json` flag to the argument parser. With it, `main`
prints `json.dumps(counts, sort_keys=True)` (one line) instead of the
`key: value` lines. Without it the output is unchanged. Add a test in
`tests/test_wc.py` that runs `main(["--json", path])` on a temp file and
checks the printed JSON.

Base status: the `must_run` is green at base and must stay green.

## Task docs-json-flag

In `README.md`, add a `### JSON output` subsection under Usage. Run
`python3 -B -m src.wc --json sample.txt` and paste the command and its exact
output as the example, then list the keys of the object and their meaning.
Keep the existing example as it is.

Base status: the `must_run` is expected-red at base (the README does not
mention `--json` yet).
